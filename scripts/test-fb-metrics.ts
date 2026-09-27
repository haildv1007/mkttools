/**
 * Test script: Compare Facebook Content Library metrics vs Graph API response
 * Run on VPS: cd /www/wwwroot/mkttools && npx ts-node scripts/test-fb-metrics.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Get published posts with socialPostId
  const items = await prisma.contentItem.findMany({
    where: { status: 'PUBLISHED', socialPostId: { not: null } },
    select: {
      id: true, topic: true, socialPostId: true, publishedAt: true, metrics: true,
      page: { select: { name: true, externalId: true, accessToken: true } },
    },
    orderBy: { publishedAt: 'desc' },
    take: 5,
  });

  console.log(`\n=== Found ${items.length} published posts ===\n`);

  for (const item of items) {
    const token = item.page?.accessToken;
    if (!token) { console.log(`SKIP ${item.topic}: no token`); continue; }

    console.log('========================================');
    console.log(`Topic: ${item.topic}`);
    console.log(`socialPostId: ${item.socialPostId}`);
    console.log(`Page: ${item.page?.name} (${item.page?.externalId})`);
    console.log(`publishedAt: ${item.publishedAt}`);

    const savedMetrics = item.metrics as Record<string, any> | null;
    console.log(`\nSaved in DB:`);
    console.log(`  fb_reach: ${savedMetrics?.fb_reach}`);
    console.log(`  fb_media_views: ${savedMetrics?.fb_media_views}`);
    console.log(`  fb_clicks: ${savedMetrics?.fb_clicks}`);

    // Step 1: Verify post identity
    console.log(`\n--- Step 1: Verify post identity ---`);
    const verifyUrl = `https://graph.facebook.com/v21.0/${item.socialPostId}?fields=id,permalink_url,created_time,message&access_token=${encodeURIComponent(token)}`;
    const verifyRes = await fetch(verifyUrl);
    const verifyJson = await verifyRes.json() as any;
    console.log(`HTTP ${verifyRes.status}`);
    console.log(`id: ${verifyJson.id}`);
    console.log(`permalink_url: ${verifyJson.permalink_url}`);
    console.log(`created_time: ${verifyJson.created_time}`);
    console.log(`message: ${(verifyJson.message || '').slice(0, 100)}`);
    if (verifyJson.error) console.log(`ERROR: ${JSON.stringify(verifyJson.error)}`);

    // Step 2: Current code's insights call (v21.0)
    console.log(`\n--- Step 2: Insights v21.0 (current code) ---`);
    const ins21Url = `https://graph.facebook.com/v21.0/${item.socialPostId}/insights?metric=post_clicks,post_total_media_view_unique,post_media_view&access_token=${encodeURIComponent(token)}`;
    const ins21Res = await fetch(ins21Url);
    const ins21Json = await ins21Res.json() as any;
    console.log(`HTTP ${ins21Res.status}`);
    if (ins21Json.data) {
      for (const m of ins21Json.data) {
        console.log(`  ${m.name} = ${m.values?.[0]?.value} (period: ${m.period})`);
      }
    }
    if (ins21Json.error) console.log(`ERROR: ${JSON.stringify(ins21Json.error)}`);

    // Step 3: Try latest API version (v22.0)
    console.log(`\n--- Step 3: Insights v22.0 ---`);
    const ins22Url = `https://graph.facebook.com/v22.0/${item.socialPostId}/insights?metric=post_clicks,post_total_media_view_unique,post_media_view&access_token=${encodeURIComponent(token)}`;
    const ins22Res = await fetch(ins22Url);
    const ins22Json = await ins22Res.json() as any;
    console.log(`HTTP ${ins22Res.status}`);
    if (ins22Json.data) {
      for (const m of ins22Json.data) {
        console.log(`  ${m.name} = ${m.values?.[0]?.value} (period: ${m.period})`);
      }
    }
    if (ins22Json.error) console.log(`ERROR: ${JSON.stringify(ins22Json.error)}`);

    // Step 4: Try post_impressions_unique (classic reach metric)
    console.log(`\n--- Step 4: Classic reach metrics ---`);
    const classicUrl = `https://graph.facebook.com/v22.0/${item.socialPostId}/insights?metric=post_impressions_unique,post_impressions&access_token=${encodeURIComponent(token)}`;
    const classicRes = await fetch(classicUrl);
    const classicJson = await classicRes.json() as any;
    console.log(`HTTP ${classicRes.status}`);
    if (classicJson.data) {
      for (const m of classicJson.data) {
        console.log(`  ${m.name} = ${m.values?.[0]?.value} (period: ${m.period})`);
      }
    }
    if (classicJson.error) console.log(`ERROR: ${JSON.stringify(classicJson.error)}`);

    // Step 5: Try individual metrics separately
    console.log(`\n--- Step 5: Individual metric calls ---`);
    for (const metric of ['post_total_media_view_unique', 'post_media_view', 'post_impressions_unique', 'post_impressions', 'post_clicks']) {
      const url = `https://graph.facebook.com/v22.0/${item.socialPostId}/insights?metric=${metric}&access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url);
      const json = await res.json() as any;
      if (json.data?.[0]) {
        console.log(`  ${metric} = ${json.data[0].values?.[0]?.value} (HTTP ${res.status})`);
      } else if (json.error) {
        console.log(`  ${metric} = ERROR: ${json.error.message?.slice(0, 80)} (HTTP ${res.status})`);
      } else {
        console.log(`  ${metric} = empty response (HTTP ${res.status})`);
      }
    }

    // Step 6: Try with period=lifetime explicitly
    console.log(`\n--- Step 6: With period=lifetime ---`);
    const ltUrl = `https://graph.facebook.com/v22.0/${item.socialPostId}/insights?metric=post_total_media_view_unique,post_media_view,post_impressions_unique&period=lifetime&access_token=${encodeURIComponent(token)}`;
    const ltRes = await fetch(ltUrl);
    const ltJson = await ltRes.json() as any;
    console.log(`HTTP ${ltRes.status}`);
    if (ltJson.data) {
      for (const m of ltJson.data) {
        console.log(`  ${m.name} = ${m.values?.[0]?.value} (period: ${m.period})`);
      }
    }
    if (ltJson.error) console.log(`ERROR: ${JSON.stringify(ltJson.error)}`);

    // Step 7: Check what fields the post object itself has
    console.log(`\n--- Step 7: Post object fields ---`);
    const fieldsUrl = `https://graph.facebook.com/v22.0/${item.socialPostId}?fields=id,type,status_type,is_published,from,shares,reactions.summary(true),comments.summary(true)&access_token=${encodeURIComponent(token)}`;
    const fieldsRes = await fetch(fieldsUrl);
    const fieldsJson = await fieldsRes.json() as any;
    console.log(`type: ${fieldsJson.type}, status_type: ${fieldsJson.status_type}, is_published: ${fieldsJson.is_published}`);
    console.log(`from: ${JSON.stringify(fieldsJson.from)}`);
    console.log(`reactions: ${fieldsJson.reactions?.summary?.total_count}, comments: ${fieldsJson.comments?.summary?.total_count}, shares: ${fieldsJson.shares?.count}`);
    if (fieldsJson.error) console.log(`ERROR: ${JSON.stringify(fieldsJson.error)}`);

    console.log('\n');
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
