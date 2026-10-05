import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function createBillingPage(search = '?tab=billing') {
  const source = readFileSync(resolve(process.cwd(), 'public/js/pages/organization.js'), 'utf8');
  const location = { search, href: '', pathname: '/organization' };
  const history = { pushState: vi.fn(), replaceState: vi.fn() };
  const context = vm.createContext({
    console,
    URLSearchParams,
    location,
    history,
    navigator: { clipboard: { writeText: vi.fn() } },
    localStorage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
    window: { MKTApi: { request: vi.fn() } },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Intl,
    Date,
    confirm: vi.fn(),
  });
  vm.runInContext(`${source}\nthis.__organizationPage = organizationPage;`, context);
  return {
    page: (context as any).__organizationPage(),
    history,
    location,
  };
}

describe('billing payment UX', () => {
  it('guards rapid payment clicks and creates only one order', async () => {
    const { page, history } = createBillingPage();
    page.billing = { paymentEnabled: true };
    page.selectedPeriod = 3;
    page.selectedPlan = {
      id: 'plan-pro', code: 'PRO_10', name: 'Pro',
      prices: [{ id: 'price-pro-3', billingMonths: 3, amount: 799000 }],
    };
    page.startPolling = vi.fn();
    let createCalls = 0;
    page.api = vi.fn(async (url: string) => {
      if (url === '/api/billing/orders') {
        createCalls += 1;
        await Promise.resolve();
        return { id: 'order-1', orderCode: 'MKT-ABC2345', status: 'PENDING' };
      }
      if (url === '/api/billing/orders/order-1/checkout') {
        return { orderCode: 'MKT-ABC2345', amount: 799000, checkout: { transferContent: 'MKT-ABC2345' } };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await Promise.all([page.startCheckout(), page.startCheckout()]);

    expect(createCalls).toBe(1);
    expect(page.activeCheckout.id).toBe('order-1');
    expect(history.pushState).toHaveBeenCalledWith({}, '', '/organization?tab=billing&order=order-1');
  });

  it('resumes the same pending order by id without creating another order', async () => {
    const { page, history } = createBillingPage('?tab=billing&order=order-7');
    page.startPolling = vi.fn();
    const requests: Array<{ url: string; method?: string }> = [];
    page.api = vi.fn(async (url: string, options: { method?: string } = {}) => {
      requests.push({ url, method: options.method });
      if (url === '/api/billing/orders/order-7') {
        return { id: 'order-7', orderCode: 'MKT-XYZ2345', status: 'PENDING', amount: 2400000 };
      }
      if (url === '/api/billing/orders/order-7/checkout') {
        return { orderCode: 'MKT-XYZ2345', amount: 2400000, checkout: { qrUrl: 'https://example.test/qr' } };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await page.resumeOrder('order-7');

    expect(requests).toEqual([
      { url: '/api/billing/orders/order-7', method: undefined },
      { url: '/api/billing/orders/order-7/checkout', method: 'POST' },
    ]);
    expect(requests.some((request) => request.url === '/api/billing/orders')).toBe(false);
    expect(page.activeCheckout.id).toBe('order-7');
    expect(history.replaceState).toHaveBeenCalledWith({}, '', '/organization?tab=billing&order=order-7');
  });

  it('shows an expired order without requesting stale checkout data', async () => {
    const { page } = createBillingPage();
    page.api = vi.fn(async (url: string) => {
      if (url === '/api/billing/orders/order-expired') {
        return { id: 'order-expired', orderCode: 'MKT-OLD2345', status: 'EXPIRED', amount: 500000 };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await page.resumeOrder('order-expired');

    expect(page.activeCheckout.status).toBe('EXPIRED');
    expect(page.api).toHaveBeenCalledTimes(1);
  });

  it('refreshes subscription context when an opened order is paid', async () => {
    const { page } = createBillingPage();
    page.refreshAfterPayment = vi.fn();

    await page.openOrder({ id: 'order-paid', orderCode: 'MKT-PAID234', status: 'PAID', amount: 1200000 });

    expect(page.activeCheckout.status).toBe('PAID');
    expect(page.refreshAfterPayment).toHaveBeenCalledOnce();
  });
});
