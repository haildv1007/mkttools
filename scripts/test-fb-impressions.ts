/**
 * Test script: Find which Graph API metric maps to Facebook "Impressions"
 * Run on VPS: cd /www/wwwroot/mkttools && npx ts-node scripts/test-fb-impressions.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const METRICS_TO_TEST = [
  // Already confirmed working
  'post_clicks',
  'post_media_view',
  'post_total_media_view_unique',
  // User requested - may map to Impressions
  'post_media_views',
  'post_media_views_paid',
  'post_media_views_organic',
  'post_media_views_follower',
  // Other candidates for Impressions
  'post_impressions',
  'post_impressions_unique',
  'post_impressions_paid',
  'post_impressions_organic',
  'post_impressions_viral',
  'post_impressions_fan',
  'post_impressions_fan_unique',
  'post_video_views',
  'post_video_views_unique',
  'post_video_view_time',
  'post_engaged_users',
  'post_engaged_fan',
  'post_negative_feedback',
  'post_reactions_by_type_total',
  'post_activity',
  'post_activity_by_action_type',
];

async function main() {
  const items = await prisma.contentItem.findMany({
    where: { status: 'PUBLISHED', socialPostId: { not: null } },
    select: {
      id: true, topic: true, socialPostId: true, metrics: true,
      page: { select: { name: true, externalId: true, accessToken: true } },
    },
    orderBy: { publishedAt: 'desc' },
    take: 5,
  });

  console.log(`Found ${items.length} published posts\n`);

  // Results table: metric -> post results
  const table: Record<string, Record<string, string>> = {};

  for (const metric of METRICS_TO_TEST) {
    table[metric] = {};
  }

  const postLabels: string[] = [];

  for (const item of items) {
    const token = item.page?.accessToken;
    if (!token) continue;

    const label = `${(item.topic || '').slice(0, 20)} (${item.socialPostId?.split('_')[1]?.slice(-6) || '?'})`;
    postLabels.push(label);

    for (const metric of METRICS_TO_TEST) {
      // Test both without and with period=lifetime
      const url = `https://graph.facebook.com/v22.0/${item.socialPostId}/insights?metric=${metric}&access_token=${encodeURIComponent(token)}`;
      try {
        const res = await fetch(url);
        const json = await res.json() as any;

        if (json.data && json.data.length > 0) {
          const vals: string[] = [];
          for (const entry of json.data) {
            const v = entry.values?.[0]?.value;
            const p = entry.period || '?';
            if (typeof v === 'object') {
              vals.push(`${JSON.stringify(v)}(${p})`);
            } else {
              vals.push(`${v}(${p})`);
            }
          }
          table[metric][label] = vals.join(' | ');
        } else if (json.error) {
          const code = json.error.code || '';
          const msg = (json.error.message || '').slice(0, 50);
          table[metric][label] = `ERR${code}: ${msg}`;
        } else {
          table[metric][label] = 'empty';
        }
      } catch (e: any) {
        table[metric][label] = `FETCH_ERR: ${e.message?.slice(0, 40)}`;
      }
    }
  }

  // Print table
  console.log('\n' + '='.repeat(120));
  console.log('METRIC RESULTS TABLE');
  console.log('='.repeat(120));

  // Header
  const colWidth = 35;
  let header = 'Metric'.padEnd(35);
  for (const pl of postLabels) {
    header += ' | ' + pl.padEnd(colWidth);
  }
  console.log(header);
  console.log('-'.repeat(header.length));

  // Rows
  for (const metric of METRICS_TO_TEST) {
    let row = metric.padEnd(35);
    for (const pl of postLabels) {
      const val = table[metric][pl] || '-';
      row += ' | ' + val.padEnd(colWidth);
    }
    console.log(row);
  }

  // Also test with period=lifetime for any metric that returned data
  console.log('\n' + '='.repeat(120));
  console.log('LIFETIME PERIOD EXPLICIT (for metrics that returned data above)');
  console.log('='.repeat(120));

  for (const item of items) {
    const token = item.page?.accessToken;
    if (!token) continue;

    const label = `${(item.topic || '').slice(0, 20)} (${item.socialPostId?.split('_')[1]?.slice(-6) || '?'})`;
    console.log(`\n--- ${label} ---`);

    // Batch all metrics with period=lifetime
    const allMetrics = METRICS_TO_TEST.join(',');
    const url = `https://graph.facebook.com/v22.0/${item.socialPostId}/insights?metric=${allMetrics}&period=lifetime&access_token=${encodeURIComponent(token)}`;
    try {
      const res = await fetch(url);
      const json = await res.json() as any;
      if (json.data) {
        for (const entry of json.data) {
          const v = entry.values?.[0]?.value;
          console.log(`  ${entry.name}: ${typeof v === 'object' ? JSON.stringify(v) : v} (${entry.period})`);
        }
      }
      if (json.error) {
        console.log(`  ERROR: ${json.error.message?.slice(0, 100)}`);
      }
    } catch (e: any) {
      console.log(`  FETCH ERROR: ${e.message}`);
    }
  }

  // DB stored values for comparison
  console.log('\n' + '='.repeat(120));
  console.log('DB STORED METRICS (for comparison)');
  console.log('='.repeat(120));
  for (const item of items) {
    const m = item.metrics as Record<string, any> | null;
    console.log(`${(item.topic || '').slice(0, 30)}: reach=${m?.fb_reach}, views=${m?.fb_media_views}, clicks=${m?.fb_clicks}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
