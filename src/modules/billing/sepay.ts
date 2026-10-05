import crypto from 'crypto';
import { logger } from '../../utils/logger';
import { getSePayConfig, getAppUrl } from '../platform-settings';

// SePay webhook payload - fields per official SePay Payment Gateway docs.
// SePay sends POST with these fields when a bank transfer matching the
// configured account is detected.
export interface SePayWebhookPayload {
  id: number;
  gateway: string;
  transactionDate: string;
  accountNumber: string;
  subAccount: string | null;
  code: string | null;        // SePay-extracted code from transfer content
  content: string;            // full transfer description
  transferType: 'in' | 'out';
  transferAmount: number;
  accumulated: number;
  referenceCode: string;
  description: string;
}

export interface SePayCheckoutInfo {
  bankAccount: string;
  bankName: string;
  accountName: string;
  amount: number;
  transferContent: string;
  qrUrl: string;
  orderCode: string;
}

export const SePayProvider = {
  verifyWebhookAuth(authHeader: string | undefined): boolean {
    const cfg = getSePayConfig();
    if (!cfg.apiKey) return false;
    if (!authHeader) return false;
    // SePay sends: "Apikey {key}" or "Bearer Apikey {key}"
    let token = authHeader;
    if (token.startsWith('Bearer ')) token = token.slice(7);
    if (token.startsWith('Apikey ')) token = token.slice(7);
    if (!token) return false;
    try {
      return crypto.timingSafeEqual(
        Buffer.from(token),
        Buffer.from(cfg.apiKey),
      );
    } catch {
      return false; // length mismatch
    }
  },

  validatePayload(body: any): { valid: boolean; payload?: SePayWebhookPayload; error?: string } {
    if (!body || typeof body !== 'object') return { valid: false, error: 'empty_body' };
    if (body.transferType !== 'in') return { valid: false, error: 'not_incoming' };
    if (!body.transferAmount || typeof body.transferAmount !== 'number' || body.transferAmount <= 0) {
      return { valid: false, error: 'invalid_amount' };
    }
    if (!body.content && !body.code) return { valid: false, error: 'no_content' };
    return { valid: true, payload: body as SePayWebhookPayload };
  },

  extractOrderCode(payload: SePayWebhookPayload): string | null {
    // SePay extracts structured codes into `code` field. Our order codes
    // follow MKT-XXXXXXX pattern. Try `code` first, then parse `content`.
    if (payload.code) {
      const match = payload.code.match(/MKT-[A-Z2-9]{7}/);
      if (match) return match[0];
    }
    if (payload.content) {
      const match = payload.content.match(/MKT-[A-Z2-9]{7}/);
      if (match) return match[0];
    }
    return null;
  },

  buildCheckoutInfo(orderCode: string, amount: number): SePayCheckoutInfo | null {
    const cfg = getSePayConfig();
    if (!cfg.configured) return null;
    const transferContent = orderCode;
    // VietQR URL format: https://qr.sepay.vn/img?acc=<account>&bank=<bank>&amount=<amount>&des=<content>&template=compact
    const qrUrl = `https://qr.sepay.vn/img?acc=${encodeURIComponent(cfg.bankAccount)}&bank=${encodeURIComponent(cfg.bankName)}&amount=${amount}&des=${encodeURIComponent(transferContent)}&template=compact`;
    return {
      bankAccount: cfg.bankAccount,
      bankName: cfg.bankName,
      accountName: cfg.accountName,
      amount,
      transferContent,
      qrUrl,
      orderCode,
    };
  },

  buildExternalEventId(payload: SePayWebhookPayload): string {
    return `sepay_${payload.id}_${payload.referenceCode || payload.transactionDate}`;
  },
};
