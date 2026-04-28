#!/usr/bin/env node

/**
 * ============================================================================
 * Follow Builders — HTML Digest Generator
 * ============================================================================
 * Reads the JSON output from prepare-digest.js and generates a styled HTML
 * page using the AI Builders Digest design system.
 *
 * Usage: node generate-html.js [output-path]
 *   Default output: ~/.follow-builders/output/index.html
 * ============================================================================
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USER_DIR = join(homedir(), '.follow-builders');
const OUTPUT_DIR = join(USER_DIR, 'output');
const DEFAULT_OUTPUT = join(OUTPUT_DIR, 'index.html');

// Parse CLI flags
const summariesIdx = process.argv.indexOf('--summaries');
const SUMMARIES_FILE = summariesIdx > -1 ? process.argv[summariesIdx + 1] : null;

// ─── Helpers ───────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(str) {
  return esc(str).replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateCN(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const months = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
  return `${d.getFullYear()}年${months[d.getMonth()]}${d.getDate()}日`;
}

function avatarInitials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function avatarImg(handle) {
  return `https://unavatar.io/x/${handle}`;
}

function renderSummaryHTML(text) {
  if (!text) return '';
  let html = esc(text);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(https?:\/\/[^\s<>"']+)/g,
    '<a class="inline-link" href="$1" target="_blank" rel="noopener">↗</a>');
  return html;
}

function renderTweetMedia(media, tweetUrl) {
  if (!Array.isArray(media) || media.length === 0) return '';
  const imgs = media.slice(0, 3).map(m => {
    const imgTag = `<img src="${escAttr(m.url || m)}" alt="" loading="lazy" onerror="this.style.display='none'" style="max-height:120px;border-radius:8px;object-fit:cover">`;
    if (tweetUrl) return `<a href="${escAttr(tweetUrl)}" target="_blank" rel="noopener">${imgTag}</a>`;
    return imgTag;
  }).join('');
  return `<div class="bc-media-strip">${imgs}</div>`;
}

function renderQuoteTweetContext(tweet) {
  if (!tweet.isQuote) return '';
  const quoted = tweet.quotedTweet;

  // Build link: prefer quoted tweet URL, fall back to quoting tweet URL
  let quoteUrl = tweet.url || '#';
  if (quoted && quoted.authorHandle && tweet.quotedTweetId) {
    quoteUrl = `https://x.com/${quoted.authorHandle}/status/${tweet.quotedTweetId}`;
  }

  const labelLink = `<a class="qt-label-link" href="${escAttr(quoteUrl)}" target="_blank" rel="noopener">↩ 引用推文</a>`;
  if (quoted && quoted.text) {
    const author = quoted.authorName ? `<span class="qt-author">${esc(quoted.authorName)}</span>` : '';
    return `<blockquote class="quote-tweet-preview"><span class="qt-label">${labelLink}</span>${author}<p class="qt-text">${esc(quoted.text.slice(0, 200))}</p></blockquote>`;
  }
  return `<blockquote class="quote-tweet-preview"><span class="qt-label">${labelLink}</span><p class="qt-text">${esc(tweet.text.slice(0, 160))}</p></blockquote>`;
}

function renderExpandableSection(fullText, previewLen) {
  if (!fullText) return '';
  previewLen = previewLen || 150;
  const needsExpand = fullText.length > previewLen;
  const preview = needsExpand ? fullText.slice(0, previewLen).replace(/\*\*/g, '').trim() + '…' : fullText.replace(/\*\*/g, '');
  const id = 'exp-' + Math.random().toString(36).slice(2, 8);
  if (!needsExpand) return `<p class="exp-content">${renderSummaryHTML(preview)}</p>`;
  return `<div class="expandable" id="${id}">
    <div class="exp-preview">
      <p class="exp-content">${renderSummaryHTML(preview)}</p>
      <button class="exp-toggle" onclick="var d=document.getElementById('${id}');d.querySelector('.exp-preview').style.display='none';d.querySelector('.exp-full').style.display='block';">展开阅读 ▾</button>
    </div>
    <div class="exp-full" style="display:none;">
      <p class="exp-content">${renderSummaryHTML(fullText.replace(/\*\*/g, '').trim())}</p>
      <button class="exp-toggle" onclick="var d=document.getElementById('${id}');d.querySelector('.exp-full').style.display='none';d.querySelector('.exp-preview').style.display='block';">收起 ▴</button>
    </div>
  </div>`;
}

// ─── Builder Card (Featured) ───────────────────────────────

function buildBuilderFeatured(b, idx, summaries) {
  const initials = avatarInitials(b.name);
  const handle = b.handle.replace('@', '');
  const tweets = b.tweets || [];

  // Build tweet link data
  let tweetLinks = [];
  if (summaries && summaries[handle] && summaries[handle].summary) {
    const twu = summaries[handle].tweets_with_urls;
    if (Array.isArray(twu) && twu.length > 0) tweetLinks = twu;
  } else {
    tweetLinks = tweets.slice(0, 5).map(t => ({ url: t.url, text: t.text }));
  }

  // Summary text — bilingual when both available
  let summaryZh = '';
  let summaryEn = '';
  if (summaries && summaries[handle] && summaries[handle].summary) {
    summaryZh = summaries[handle].summary;
    summaryEn = summaries[handle].summary_en || '';
  }
  if (!summaryZh && tweets.length > 0) {
    // Fallback: use raw tweet text
    const raw = tweets[0].text.replace(/https:\/\/t\.co\/\w+/g, '').replace(/\n+/g, ' ').trim();
    summaryZh = raw.length > 120 ? raw.slice(0, 120) + '…' : raw;
    summaryEn = summaryZh; // same fallback for EN
  }
  // If EN not explicitly set, fall back to ZH
  if (!summaryEn) summaryEn = summaryZh;

  const tweetButtons = tweetLinks.length > 0
    ? `<div class="bc-tweet-links">${tweetLinks.map((tw, i) => {
        const preview = String(tw.text || '').replace(/https?:\/\/\S+/g, '').replace(/\n+/g, ' ').trim();
        const label = tweetLinks.length > 1 ? `推文 ${i + 1}` : '查看推文';
        return `<a class="bc-tweet-btn" href="${escAttr(tw.url)}" target="_blank" rel="noopener" title="${escAttr(preview.slice(0, 80))}">↗ ${label}</a>`;
      }).join('')}</div>`
    : '';

  const firstMedia = tweets.find(t => t.media && t.media.length > 0);
  const mediaStrip = firstMedia ? renderTweetMedia(firstMedia.media, firstMedia.url) : '';
  const firstQuote = tweets.find(t => t.isQuote);
  const quoteBlock = firstQuote ? renderQuoteTweetContext(firstQuote) : '';

  return `<article class="builder-card-rich">
    <div class="bc-header">
      <img class="bc-avatar" src="${escAttr(avatarImg(handle))}" alt="${esc(b.name)} avatar" loading="lazy"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
      <div class="bc-avatar-fallback" style="display:none;" aria-hidden="true">${esc(initials)}</div>
      <div>
        <div class="bc-name">${esc(b.name)} <span class="bc-handle">@${esc(handle)}</span></div>
        <div class="bc-role">${esc(b.bio ? b.bio.replace(/https?:\/\/\S+/g, '').trim() : 'Builder')}</div>
      </div>
    </div>
    <p class="bi-zh bc-summary">${renderSummaryHTML(summaryZh)}</p>
    <p class="bi-en bc-summary">${renderSummaryHTML(summaryEn)}</p>
    ${mediaStrip}
    ${quoteBlock}
    ${tweetButtons}
  </article>`;
}

// ─── Builder Row (Compact) ─────────────────────────────────

function buildBuilderCompact(b, summaries) {
  const initials = avatarInitials(b.name);
  const handle = b.handle.replace('@', '');
  const tweets = b.tweets || [];
  const tweet = tweets[0] || null;

  let summaryZh = '';
  let summaryEn = '';
  if (summaries && summaries[handle] && summaries[handle].summary) {
    summaryZh = summaries[handle].summary.replace(/\*\*/g, '').trim();
    summaryEn = (summaries[handle].summary_en || '').replace(/\*\*/g, '').trim();
  } else if (tweet) {
    const raw = tweet.text.replace(/https:\/\/t\.co\/\w+/g, '').replace(/\n+/g, ' ').trim().slice(0, 100);
    summaryZh = raw;
    summaryEn = raw;
  }
  if (!summaryEn) summaryEn = summaryZh;

  const tweetButtons = tweets.slice(0, 5).map((t, i) => {
    const label = tweets.length > 1 ? `推文 ${i + 1}` : '推文';
    return `<a class="bc-tweet-btn" href="${escAttr(t.url)}" target="_blank" rel="noopener" title="${escAttr((t.text || '').slice(0, 80))}">↗ ${label}</a>`;
  }).join('');

  return `<a class="builder-compact-row" href="${escAttr(tweet ? tweet.url : '#')}" target="_blank" rel="noopener" aria-label="${esc(b.name)} - view on X">
    <img class="bcr-avatar" src="${escAttr(avatarImg(handle))}" alt="" loading="lazy"
      onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
    <div class="bcr-avatar-fallback" style="display:none;" aria-hidden="true">${esc(initials)}</div>
    <div class="bcr-info"><span class="bcr-name">${esc(b.name)}</span> <span class="bcr-handle">@${esc(handle)}</span>
      · <span class="bcr-role">${esc(b.bio ? b.bio.replace(/https?:\/\/\S+/g, '').trim() : '')}</span></div>
    <span class="bcr-summary bi-zh">${esc(summaryZh)}</span>
    <span class="bcr-summary bi-en">${esc(summaryEn)}</span>
    <span class="bcr-links">${tweetButtons}</span>
  </a>`;
}

// ─── Blog Card ─────────────────────────────────────────────

function buildBlogCard(blog, blogSummary) {
  const summaryZh = blogSummary?.summary_zh || null;
  const summaryEn = blogSummary?.summary_en || null;

  const zhBlock = summaryZh
    ? renderExpandableSection(summaryZh, 150)
    : `<p class="blog-summary bi-zh">${esc((blog.content || '').replace(/<[^>]+>/g, '').trim().slice(0, 200) + '…')}</p>`;

  const enBlock = summaryEn
    ? `<div class="bi-en">${renderExpandableSection(summaryEn, 150)}</div>`
    : (summaryZh ? '' : `<p class="blog-summary bi-en">${esc((blog.content || '').replace(/<[^>]+>/g, '').trim().slice(0, 200) + '…')}</p>`);

  return `<article class="blog-card">
    <div class="blog-body">
      <span class="blog-source-tag">${esc(blog.name)}</span>
      <h3>${esc(blog.title)}</h3>
      ${zhBlock}
      ${enBlock}
      <a class="blog-link" href="${escAttr(blog.url)}" target="_blank" rel="noopener">阅读全文 →</a>
    </div>
  </article>`;
}

// ─── Podcast Card ──────────────────────────────────────────

function buildPodcastCard(podcast, podcastSummary) {
  const summaryZh = podcastSummary?.summary_zh || null;
  const summaryEn = podcastSummary?.summary_en || null;

  const zhBlock = summaryZh
    ? renderExpandableSection(summaryZh, 200)
    : `<p class="pc-summary bi-zh">${esc((podcast.transcript || '').replace(/Speaker \d \| [\d:]+\n/g, '').trim().slice(0, 500) + '…')}</p>`;

  const enBlock = summaryEn
    ? `<div class="bi-en">${renderExpandableSection(summaryEn, 200)}</div>`
    : (summaryZh ? '' : `<p class="pc-summary bi-en">${esc((podcast.transcript || '').replace(/Speaker \d \| [\d:]+\n/g, '').trim().slice(0, 500) + '…')}</p>`);

  return `<article class="podcast-card">
    <div class="pc-cover-wrap">
      <div class="pc-cover" style="background:linear-gradient(135deg,#f97316,#ec4899);border-radius:12px;width:120px;height:120px;display:flex;align-items:center;justify-content:center;font-size:48px;color:#fff;">🎙</div>
    </div>
    <div class="pc-body">
      <span class="pc-source">${esc(podcast.name)}</span>
      <h3>${esc(podcast.title)}</h3>
      ${zhBlock}
      ${enBlock}
      <a class="pc-link" href="${escAttr(podcast.url)}" target="_blank" rel="noopener">收听本期 →</a>
    </div>
  </article>`;
}

// ─── X Article Card ────────────────────────────────────────

function buildXArticleCard(entry, xArticleSummary) {
  const handle = entry.handle.replace('@', '');
  const article = entry.article || {};

  const summaryZh = xArticleSummary?.summary_zh || null;
  const summaryEn = xArticleSummary?.summary_en || null;

  let zhHtml, enHtml;
  if (summaryZh) {
    zhHtml = `<p class="article-summary bi-zh">${renderSummaryHTML(summaryZh)}</p>`;
    enHtml = summaryEn
      ? `<p class="article-summary bi-en">${renderSummaryHTML(summaryEn)}</p>`
      : '';
  } else {
    const fallback = article.text
      ? article.text.replace(/\*\*/g, '').replace(/\n+/g, ' ').trim().slice(0, 300) + '…'
      : '';
    zhHtml = `<p class="article-summary bi-zh">${esc(fallback)}</p>`;
    enHtml = `<p class="article-summary bi-en">${esc(fallback)}</p>`;
  }

  return `<article class="article-card">
    <div class="bc-header">
      <img class="bc-avatar" src="${escAttr(avatarImg(handle))}" alt="${esc(entry.name)}" loading="lazy"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
      <div class="bc-avatar-fallback" style="display:none;" aria-hidden="true">${esc(avatarInitials(entry.name))}</div>
      <div>
        <div class="bc-name">${esc(entry.name)} <span class="bc-handle">@${esc(handle)}</span></div>
        <div class="bc-role">${esc((entry.bio || '').replace(/https?:\/\/\S+/g, '').trim())}</div>
      </div>
    </div>
    <h3 class="article-title">${esc(article.title || '')}</h3>
    ${zhHtml}
    ${enHtml}
    <a class="article-link" href="${escAttr(article.url || '#')}" target="_blank" rel="noopener">阅读全文 →</a>
  </article>`;
}

// ─── Signal Cards ──────────────────────────────────────────

function buildSignalCards(builders, stats) {
  const signals = [];

  const topBuilders = builders.slice(0, 3).map(b => b.name).join('、');
  signals.push({
    label: 'Signal 01',
    title: `今日 ${stats.xBuilders} 位 AI Builder 活跃发声`,
    summary: `${topBuilders} 等人发布重要内容，从产品发布到行业洞察，coding agent 和模型更新仍是最受关注的焦点。`,
    chips: `<span class="signal-chip chip-x">X</span>`
  });

  // Signal 2: X Articles if available
  if (stats.xArticles > 0) {
    signals.push({
      label: 'Signal 02',
      title: `${stats.xArticles} 篇 X 长文`,
      summary: 'Builder 发布深度长文，涵盖技术洞察、产品思考与行业趋势，值得完整阅读。',
      chips: `<span class="signal-chip chip-x">X Article</span>`
    });
  }

  // Signal 3: Blog highlight
  const blogs = (stats.blogPosts > 0) ? `共 ${stats.blogPosts} 篇官方博文` : '';
  signals.push({
    label: stats.xArticles > 0 ? 'Signal 03' : 'Signal 02',
    title: 'AI 实验室官博更新',
    summary: `Anthropic、Claude 等发布最新博文${blogs ? '，' + blogs : ''}涵盖 postmortem、产品更新等关键信息。`,
    chips: `<span class="signal-chip chip-blog">Blog</span>`
  });

  // Signal 4: Podcast if available
  if (stats.podcastEpisodes > 0) {
    signals.push({
      label: stats.xArticles > 0 ? 'Signal 04' : 'Signal 03',
      title: '播客：AI 基建与 Coding Agents 新趋势',
      summary: '行业播客讨论 AI 基础设施趋稳、skills 格式成事实标准、agent 时代 API-first 成为产品必备。',
      chips: `<span class="signal-chip chip-podcast">Podcast</span>`
    });
  }

  // Signal 5: Overall insight
  const sigNum = stats.xArticles > 0 ? (stats.podcastEpisodes > 0 ? 'Signal 05' : 'Signal 04') : (stats.podcastEpisodes > 0 ? 'Signal 04' : 'Signal 03');
  signals.push({
    label: sigNum,
    title: `${stats.totalTweets} 条推文 · 密集信息流`,
    summary: `今日共采集 ${stats.totalTweets} 条高质量推文，涵盖 GPT-5.5、Claude Code、Managed Agents Memory、AI 基建等核心话题。`,
    chips: `<span class="signal-chip chip-x">X</span><span class="signal-chip chip-blog">Blog</span>`
  });

  const signalCount = signals.length;
  return { cards: signals.map(s => `<article class="signal-card">
    <span class="signal-label">${s.label}</span>
    <h3 class="signal-title">${esc(s.title)}</h3>
    <p class="signal-summary">${esc(s.summary)}</p>
    <div class="signal-chips">${s.chips}</div>
  </article>`).join('\n'), count: signalCount };
}

// ─── Main Generator ────────────────────────────────────────

async function generate() {
  // Step 1: Run prepare-digest.js to get fresh data
  const scriptDir = join(__dirname);
  let raw;
  try {
    raw = execSync(`node ${join(scriptDir, 'prepare-digest.js')} 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 60000
    });
  } catch (err) {
    console.error('Failed to run prepare-digest.js:', err.message);
    process.exit(1);
  }

  const data = JSON.parse(raw);
  if (data.status !== 'ok') {
    console.error('prepare-digest returned error status');
    process.exit(1);
  }

  const { x: builders, blogs, podcasts, stats, config, xArticles } = data;

  // Load Chinese summaries if --summaries flag provided
  let builderSummaries = null;
  let blogSummaries = [];
  let podcastSummaries = [];
  let xArticleSummaries = [];
  if (SUMMARIES_FILE) {
    try {
      const summariesRaw = await readFile(SUMMARIES_FILE, 'utf-8');
      const parsed = JSON.parse(summariesRaw);
      if (parsed.builders) {
        builderSummaries = parsed.builders;
        blogSummaries = parsed.blogs || [];
        podcastSummaries = parsed.podcasts || [];
        xArticleSummaries = parsed.xArticles || [];
      } else {
        builderSummaries = parsed;
      }
      console.log(`Loaded summaries: ${Object.keys(builderSummaries || {}).length} builders, ${blogSummaries.length} blogs, ${podcastSummaries.length} podcasts, ${xArticleSummaries.length} xArticles`);
    } catch (err) {
      console.error('Failed to load summaries file:', err.message);
    }
  }

  // Build handle→summary map for X Articles
  const xArticleSummaryMap = {};
  for (const xas of xArticleSummaries) {
    xArticleSummaryMap[xas.handle.replace('@', '')] = xas;
  }

  // Determine output path — skip --summaries flag and its value
  let outputPath = DEFAULT_OUTPUT;
  for (const arg of process.argv) {
    if (arg.endsWith('.html') || arg.endsWith('.htm')) {
      outputPath = arg;
      break;
    }
  }
  await mkdir(dirname(outputPath), { recursive: true });

  // Build date
  const today = new Date();
  const dateStr = formatDateCN(today);
  const dateISO = formatDate(today);

  // Build sections
  const signalData = buildSignalCards(builders, stats);
  const signalCards = signalData.cards;

  // Featured builders (top 6)
  const featured = builders.slice(0, 6).map((b, i) => buildBuilderFeatured(b, i, builderSummaries)).join('\n');

  // Remaining builders (compact)
  const compact = builders.slice(6).map(b => buildBuilderCompact(b, builderSummaries)).join('\n');
  const compactSection = compact
    ? `<details class="view-all-wrapper">
        <summary>查看全部 ${stats.xBuilders} 位 Builder ▾</summary>
        <div class="builders-compact">${compact}</div>
       </details>`
    : '';

  // X Articles
  const xArticlesList = xArticles || [];
  const articleCards = xArticlesList.map(a => {
    const h = (a.handle || '').replace('@', '');
    return buildXArticleCard(a, xArticleSummaryMap[h] || null);
  }).join('\n');
  const hasArticles = xArticlesList.length > 0;
  const articleSection = hasArticles
    ? `<section class="section-panel" id="section-x-articles" aria-labelledby="articles-heading">
        <div class="section-panel-header">
          <div class="section-icon icon-blog" aria-hidden="true">📄</div>
          <h2 id="articles-heading">X 长文</h2>
          <span class="section-desc">Builder 深度分享</span>
          <span class="section-badge">${stats.xArticles || xArticlesList.length} 篇</span>
        </div>
        <div class="article-grid">${articleCards}</div>
       </section>`
    : '';
  const articlesNav = hasArticles
    ? `\n                <a href="#section-x-articles" class="nav-x">📄 X 长文 <span class="nav-badge">${stats.xArticles || xArticlesList.length}</span></a>`
    : '';

  // Blogs
  const blogCards = blogs.map((b, i) => buildBlogCard(b, blogSummaries[i] || null)).join('\n');

  // Podcasts
  const podcastCards = podcasts.map((p, i) => buildPodcastCard(p, podcastSummaries[i] || null)).join('\n');

  // Build the full HTML
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Builders Digest — ${dateISO}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

        :root {
            --bg: #050711;
            --bg-2: #080d1a;
            --surface: rgba(15, 23, 42, 0.72);
            --surface-solid: #101827;
            --surface-2: rgba(30, 41, 59, 0.64);
            --border: rgba(148, 163, 184, 0.22);
            --border-strong: rgba(148, 163, 184, 0.36);
            --text: #f8fafc;
            --text-muted: #94a3b8;
            --text-soft: #cbd5e1;
            --blue: #3b82f6;
            --cyan: #22d3ee;
            --violet: #8b5cf6;
            --green: #22c55e;
            --orange: #f97316;
            --pink: #ec4899;
            --x-accent: #3b82f6;
            --blog-accent: #22c55e;
            --podcast-accent: #f97316;
            --glow-blue: rgba(59, 130, 246, 0.25);
            --glow-violet: rgba(139, 92, 246, 0.22);
            --glow-green: rgba(34, 197, 94, 0.18);
            --glow-orange: rgba(249, 115, 22, 0.2);
            --radius-sm: 12px;
            --radius-md: 18px;
            --radius-lg: 22px;
            --radius-xl: 24px;
            --sidebar-w: 268px;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }
        html { scroll-behavior: smooth; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
        body {
            font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', 'WenQuanYi Micro Hei', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: var(--bg);
            background-image:
                radial-gradient(ellipse 80% 60% at 50% -8%, rgba(139, 92, 246, 0.08) 0%, transparent 70%),
                radial-gradient(ellipse 60% 50% at 85% 15%, rgba(59, 130, 246, 0.06) 0%, transparent 65%),
                radial-gradient(ellipse 40% 60% at 15% 60%, rgba(34, 211, 238, 0.04) 0%, transparent 70%);
            color: var(--text);
            line-height: 1.8;
            min-height: 100vh;
        }

        .app-shell {
            display: grid;
            grid-template-columns: var(--sidebar-w) 1fr;
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px 24px 48px;
            gap: 28px;
            align-items: start;
        }

        .sidebar {
            position: sticky;
            top: 20px;
            display: flex;
            flex-direction: column;
            gap: 20px;
            background: var(--surface);
            backdrop-filter: blur(18px);
            -webkit-backdrop-filter: blur(18px);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 24px 20px 20px;
            z-index: 10;
            min-height: fit-content;
        }
        .sidebar-brand { display: flex; align-items: center; gap: 12px; }
        .sidebar-brand .brand-icon {
            width: 40px; height: 40px; border-radius: 10px;
            background: linear-gradient(135deg, #8b5cf6, #3b82f6);
            display: flex; align-items: center; justify-content: center;
            font-weight: 800; font-size: 15px; color: #fff;
            flex-shrink: 0; letter-spacing: -0.5px;
            box-shadow: 0 0 24px rgba(139, 92, 246, 0.35);
        }
        .sidebar-brand .brand-text { font-weight: 700; font-size: 15px; color: var(--text); letter-spacing: -0.2px; line-height: 1.3; }
        .sidebar-meta { font-size: 12px; color: var(--text-muted); line-height: 1.6; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
        .sidebar-meta .issue-date { font-weight: 600; color: var(--text-soft); font-size: 13px; display: block; margin-bottom: 2px; }

        .sidebar-nav { display: flex; flex-direction: column; gap: 4px; }
        .sidebar-nav .nav-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted); font-weight: 600; margin-bottom: 2px; }
        .sidebar-nav a {
            display: flex; align-items: center; justify-content: space-between;
            padding: 9px 12px; border-radius: 10px; text-decoration: none;
            color: var(--text-soft); font-size: 13px; font-weight: 500;
            transition: all 0.2s; border: 1px solid transparent;
        }
        .sidebar-nav a:hover, .sidebar-nav a:focus-visible {
            background: var(--surface-2); border-color: var(--border); color: var(--text); outline: none;
        }
        .sidebar-nav .nav-badge {
            font-size: 10px; font-weight: 600; padding: 3px 8px; border-radius: 100px;
            background: var(--surface-solid); border: 1px solid var(--border); color: var(--text-muted);
            font-family: 'JetBrains Mono', monospace; min-width: 22px; text-align: center;
        }
        .sidebar-nav a.nav-x .nav-badge { border-color: rgba(59, 130, 246, 0.4); color: var(--blue); }
        .sidebar-nav a.nav-blog .nav-badge { border-color: rgba(34, 197, 94, 0.4); color: var(--green); }
        .sidebar-nav a.nav-podcast .nav-badge { border-color: rgba(249, 115, 22, 0.4); color: var(--orange); }

        .sidebar-footer { font-size: 11px; color: var(--text-muted); text-align: center; padding-top: 6px; border-top: 1px solid var(--border); line-height: 1.5; }
        .sidebar-footer a { color: var(--violet); text-decoration: none; font-weight: 500; }
        .sidebar-footer a:hover { text-decoration: underline; }

        .lang-toggle {
            display: inline-flex; align-items: center; gap: 6px;
            background: var(--surface-2); border: 1px solid var(--border);
            border-radius: 100px; padding: 4px; cursor: pointer;
            font-size: 11px; font-weight: 600; font-family: 'JetBrains Mono',monospace;
            color: var(--text-muted); transition: all 0.2s; user-select: none;
            width: fit-content;
        }
        .lang-toggle:hover { border-color: var(--border-strong); color: var(--text); }
        .lang-toggle .lt-option {
            padding: 5px 12px; border-radius: 100px; transition: all 0.2s;
        }
        .lang-toggle .lt-option.active {
            background: var(--violet); color: #fff;
            box-shadow: 0 0 12px rgba(139, 92, 246, 0.3);
        }

        .main-content { display: flex; flex-direction: column; gap: 28px; min-width: 0; }

        .hero-panel {
            position: relative; border-radius: var(--radius-xl); padding: 36px 32px 32px;
            background: var(--surface); backdrop-filter: blur(18px);
            border: 1px solid var(--border-strong); overflow: hidden;
            display: flex; flex-direction: column; gap: 20px;
        }
        .hero-panel::before {
            content: ''; position: absolute; top: -60%; right: -30%;
            width: 100%; height: 200%;
            background: radial-gradient(ellipse at center, rgba(139, 92, 246, 0.14) 0%, transparent 60%);
            pointer-events: none;
        }
        .hero-panel::after {
            content: ''; position: absolute; bottom: -40%; left: -20%;
            width: 80%; height: 140%;
            background: radial-gradient(ellipse at center, rgba(59, 130, 246, 0.09) 0%, transparent 55%);
            pointer-events: none;
        }
        .hero-panel > * { position: relative; z-index: 1; }
        .hero-badge {
            display: inline-flex; align-items: center; gap: 6px;
            background: var(--surface-2); border: 1px solid var(--border);
            border-radius: 100px; padding: 5px 14px;
            font-size: 11px; font-weight: 600; color: var(--violet);
            letter-spacing: 0.6px; text-transform: uppercase; width: fit-content;
        }
        .hero-badge::before {
            content: ''; width: 6px; height: 6px; border-radius: 50%;
            background: var(--green); animation: heroPulse 2s ease-in-out infinite;
        }
        @keyframes heroPulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        .hero-title {
            font-size: clamp(34px, 5vw, 54px); font-weight: 800; letter-spacing: -0.8px; line-height: 1.1;
            background: linear-gradient(135deg, #f8fafc 0%, #cbd5e1 50%, #94a3b8 100%);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .hero-subtitle { font-size: 14px; color: var(--text-muted); line-height: 1.5; max-width: 600px; }
        .hero-subtitle strong { color: var(--text-soft); font-weight: 600; }
        .hero-stats { display: flex; flex-wrap: wrap; gap: 12px; }
        .stat-tile {
            display: flex; align-items: center; gap: 8px;
            background: var(--surface-2); border: 1px solid var(--border);
            border-radius: var(--radius-sm); padding: 10px 16px;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .stat-tile:hover { border-color: var(--border-strong); box-shadow: 0 0 14px rgba(139, 92, 246, 0.1); }
        .stat-tile .stat-icon { font-size: 18px; flex-shrink: 0; }
        .stat-tile .stat-num { font-weight: 700; font-size: 20px; color: var(--text); letter-spacing: -0.3px; font-family: 'JetBrains Mono',monospace; }
        .stat-tile .stat-label { font-size: 12px; color: var(--text-muted); font-weight: 500; }

        .section-panel {
            background: var(--surface); backdrop-filter: blur(18px);
            border: 1px solid var(--border); border-radius: var(--radius-lg);
            padding: 24px 24px 20px; display: flex; flex-direction: column; gap: 16px;
        }
        .section-panel-header { display: flex; align-items: center; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
        .section-panel-header .section-icon {
            width: 32px; height: 32px; border-radius: 8px;
            display: flex; align-items: center; justify-content: center;
            font-size: 15px; font-weight: 700; flex-shrink: 0;
        }
        .section-icon.icon-x { background: linear-gradient(135deg,#3b82f6,#8b5cf6); color: #fff; }
        .section-icon.icon-blog { background: linear-gradient(135deg,#22c55e,#22d3ee); color: #000; }
        .section-icon.icon-podcast { background: linear-gradient(135deg,#f97316,#ec4899); color: #fff; }
        .section-icon.icon-signal { background: linear-gradient(135deg,#8b5cf6,#22d3ee); color: #fff; }
        .section-panel-header h2 { font-size: 16px; font-weight: 700; letter-spacing: -0.3px; color: var(--text); }
        .section-panel-header .section-desc { font-size: 12px; color: var(--text-muted); flex: 1; }
        .section-panel-header .section-badge {
            font-size: 11px; font-weight: 600; padding: 4px 12px; border-radius: 100px;
            background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted);
            font-family: 'JetBrains Mono',monospace; white-space: nowrap;
        }

        .signal-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 12px; }
        .signal-card {
            background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-md);
            padding: 16px 18px; transition: border-color 0.2s, box-shadow 0.2s;
            display: flex; flex-direction: column; gap: 8px;
        }
        .signal-card:hover { border-color: var(--border-strong); box-shadow: 0 0 20px rgba(139,92,246,0.08); }
        .signal-card .signal-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--violet); font-weight: 700; font-family: 'JetBrains Mono',monospace; }
        .signal-card .signal-title { font-size: 14px; font-weight: 700; color: var(--text); letter-spacing: -0.2px; line-height: 1.35; }
        .signal-card .signal-summary { font-size: 12px; color: var(--text-muted); line-height: 1.55; }
        .signal-card .signal-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: auto; }
        .signal-chip { font-size: 10px; padding: 3px 8px; border-radius: 6px; font-weight: 600; letter-spacing: 0.3px; border: 1px solid transparent; }
        .signal-chip.chip-x { background: rgba(59,130,246,0.15); border-color: rgba(59,130,246,0.3); color: var(--blue); }
        .signal-chip.chip-blog { background: rgba(34,197,94,0.12); border-color: rgba(34,197,94,0.28); color: var(--green); }
        .signal-chip.chip-podcast { background: rgba(249,115,22,0.13); border-color: rgba(249,115,22,0.3); color: var(--orange); }

        .builder-featured-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 14px; }
        .builder-card-rich {
            background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-md);
            padding: 18px 20px; transition: all 0.2s; display: flex; flex-direction: column; gap: 10px;
        }
        .builder-card-rich:hover { border-color: rgba(59,130,246,0.45); box-shadow: 0 0 22px rgba(59,130,246,0.1); transform: translateY(-1px); }
        .builder-card-rich .bc-header { display: flex; align-items: center; gap: 10px; }
        .builder-card-rich .bc-avatar { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 2px solid var(--border); flex-shrink: 0; background: var(--surface-solid); }
        .builder-card-rich .bc-avatar-fallback { width:40px;height:40px;border-radius:50%;border:2px solid var(--border);flex-shrink:0;background:var(--surface-solid);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;color:var(--text-muted); }
        .builder-card-rich .bc-name { font-weight: 700; font-size: 14px; color: var(--text); letter-spacing: -0.2px; }
        .builder-card-rich .bc-handle { font-size: 12px; color: var(--text-muted); font-weight: 400; }
        .builder-card-rich .bc-role { font-size: 11px; color: var(--text-muted); font-weight: 500; }
        .builder-card-rich .bc-summary { font-size: 13px; color: var(--text-soft); line-height: 1.6; }
        /* Language toggle: hide non-active language */
        body.lang-zh .bi-en { display: none; }
        body.lang-en .bi-zh { display: none; }
        .builder-card-rich .bc-links { display: flex; flex-wrap: wrap; gap: 5px; }
        .bc-link {
            display: inline-flex; align-items: center; gap: 3px; padding: 4px 10px;
            background: var(--surface-solid); border: 1px solid var(--border); border-radius: 6px;
            font-size: 10px; color: var(--blue); text-decoration: none; font-family: 'JetBrains Mono',monospace; transition: all 0.2s;
        }
        .bc-link:hover { border-color: var(--blue); background: rgba(59,130,246,0.1); color: var(--cyan); }

        .bc-tweet-links { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
        .bc-tweet-btn {
            display: inline-flex; align-items: center; gap: 3px; padding: 4px 10px;
            background: var(--surface-solid); border: 1px solid var(--border); border-radius: 6px;
            font-size: 10px; color: var(--blue); text-decoration: none;
            font-family: 'JetBrains Mono',monospace; transition: all 0.2s;
        }
        .bc-tweet-btn:hover { border-color: var(--blue); background: rgba(59,130,246,0.1); color: var(--cyan); }

        .inline-link {
            color: var(--blue); text-decoration: none;
            font-size: 11px; vertical-align: super;
            transition: color 0.15s; margin: 0 2px;
        }
        .inline-link:hover { color: var(--cyan); }

        .bc-media-strip { display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
        .bc-media-strip a { display: contents; }
        .bc-media-strip img { border-radius: 8px; max-height: 120px; object-fit: cover; border: 1px solid var(--border); transition: border-color 0.2s; }
        .bc-media-strip img:hover { border-color: var(--border-strong) !important; }

        .quote-tweet-preview {
            border-left: 2px solid var(--border); padding: 6px 10px; margin: 6px 0;
            border-radius: 0 8px 8px 0; background: rgba(148,163,184,0.04);
            font-size: 11px; color: var(--text-muted);
        }
        .qt-label { font-size: 9px; font-weight: 700; color: var(--violet); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px; }
        .qt-label-link { color: var(--violet); text-decoration: none; transition: color 0.15s; }
        .qt-label-link:hover { color: var(--blue); text-decoration: underline; }
        .qt-author { font-weight: 600; color: var(--text-soft); font-size: 11px; }
        .qt-text { margin-top: 2px; line-height: 1.5; }
        .qt-badge { font-size: 9px; font-weight: 600; color: var(--violet); background: rgba(139,92,246,0.1); padding: 2px 6px; border-radius: 4px; }

        .exp-content { font-size: 13px; color: var(--text-soft); line-height: 1.8; }
        .exp-toggle {
            background: none; border: none; color: var(--blue); cursor: pointer;
            font-size: 12px; font-weight: 600; padding: 4px 0; font-family: inherit;
            transition: color 0.15s; margin-top: 4px;
        }
        .exp-toggle:hover { color: var(--cyan); }

        .article-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 14px; }
        .article-card {
            background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-md);
            padding: 18px 20px; transition: all 0.2s; display: flex; flex-direction: column; gap: 10px;
        }
        .article-card:hover { border-color: rgba(34,197,94,0.45); box-shadow: 0 0 22px rgba(34,197,94,0.08); transform: translateY(-1px); }
        .article-card .bc-header { display: flex; align-items: center; gap: 10px; }
        .article-card .bc-avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; border: 2px solid var(--border); flex-shrink: 0; background: var(--surface-solid); }
        .article-card .bc-avatar-fallback { width:36px;height:36px;border-radius:50%;border:2px solid var(--border);flex-shrink:0;background:var(--surface-solid);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:var(--text-muted); }
        .article-card .bc-name { font-weight: 700; font-size: 13px; color: var(--text); letter-spacing: -0.2px; }
        .article-card .bc-handle { font-size: 11px; color: var(--text-muted); font-weight: 400; }
        .article-card .bc-role { font-size: 10px; color: var(--text-muted); font-weight: 500; }
        .article-card .article-title { font-size: 14px; font-weight: 700; color: var(--text); letter-spacing: -0.2px; line-height: 1.35; }
        .article-card .article-summary { font-size: 12px; color: var(--text-muted); line-height: 1.6; }        .article-card .article-link { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--green); text-decoration: none; font-weight: 600; transition: opacity 0.2s; margin-top: auto; }
        .article-card .article-link:hover { opacity: 0.7; }

        .builders-compact { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
        .builder-compact-row {
            display: flex; align-items: center; gap: 10px; padding: 10px 14px;
            background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px;
            transition: border-color 0.2s; text-decoration: none; color: inherit; flex-wrap: wrap;
        }
        .builder-compact-row:hover { border-color: var(--border-strong); }
        .builder-compact-row .bcr-avatar { width: 30px; height: 30px; border-radius: 50%; object-fit: cover; border: 1.5px solid var(--border); flex-shrink: 0; background: var(--surface-solid); }
        .builder-compact-row .bcr-avatar-fallback { width:30px;height:30px;border-radius:50%;border:1.5px solid var(--border);flex-shrink:0;background:var(--surface-solid);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;color:var(--text-muted); }
        .builder-compact-row .bcr-info { flex: 1; min-width: 0; }
        .builder-compact-row .bcr-name { font-weight: 600; font-size: 13px; color: var(--text); letter-spacing: -0.2px; }
        .builder-compact-row .bcr-handle { font-size: 11px; color: var(--text-muted); }
        .builder-compact-row .bcr-role { font-size: 11px; color: var(--text-muted); }
        .builder-compact-row .bcr-summary { font-size: 11px; color: var(--text-muted); line-height: 1.4; flex-basis: 100%; margin-top: 2px; }
        .builder-compact-row .bcr-links { display: flex; gap: 4px; flex-wrap: wrap; flex-shrink: 0; }

        .view-all-wrapper { margin-top: 4px; }
        .view-all-wrapper>summary {
            cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
            padding: 9px 16px; border-radius: 10px; border: 1px solid var(--border);
            background: var(--surface-2); color: var(--text-soft); font-size: 12px;
            font-weight: 600; transition: all 0.2s; user-select: none; font-family: 'Inter',sans-serif;
        }
        .view-all-wrapper>summary:hover { border-color: var(--border-strong); color: var(--text); }

        .blog-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; }
        .blog-card {
            background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-md);
            overflow: hidden; transition: all 0.2s; display: flex; flex-direction: column;
        }
        .blog-card:hover { border-color: rgba(34,197,94,0.45); box-shadow: 0 0 22px rgba(34,197,94,0.08); transform: translateY(-1px); }
        .blog-card .blog-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
        .blog-card .blog-source-tag { font-size: 10px; font-weight: 700; color: var(--green); text-transform: uppercase; letter-spacing: 0.5px; }
        .blog-card h3 { font-size: 14px; font-weight: 700; color: var(--text); letter-spacing: -0.2px; line-height: 1.35; }
        .blog-card .blog-summary { font-size: 12px; color: var(--text-muted); line-height: 1.55; flex:1; }        .blog-card .blog-link { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--green); text-decoration: none; font-weight: 600; transition: opacity 0.2s; margin-top: auto; }
        .blog-card .blog-link:hover { opacity: 0.7; }

        .podcast-card {
            background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-md);
            overflow: hidden; transition: all 0.2s; display: flex; gap: 0;
        }
        .podcast-card:hover { border-color: rgba(249,115,22,0.45); box-shadow: 0 0 22px rgba(249,115,22,0.08); transform: translateY(-1px); }
        .podcast-card .pc-cover-wrap {
            flex-shrink: 0; width: 160px; min-height: 180px;
            position: relative; background: var(--surface-solid);
            border-right: 1px solid var(--border);
            display: flex; align-items: center; justify-content: center;
        }
        .podcast-card .pc-body { padding: 20px 22px; flex: 1; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
        .podcast-card .pc-source { font-size: 11px; font-weight: 700; color: var(--orange); text-transform: uppercase; letter-spacing: 0.5px; }
        .podcast-card h3 { font-size: 15px; font-weight: 700; color: var(--text); letter-spacing: -0.2px; line-height: 1.35; }
        .podcast-card .pc-summary { font-size: 12px; color: var(--text-muted); line-height: 1.6; }        .podcast-card .pc-link { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--orange); text-decoration: none; font-weight: 600; transition: opacity 0.2s; margin-top: auto; }
        .podcast-card .pc-link:hover { opacity: 0.7; }

        .page-footer { text-align: center; padding: 24px; border-top: 1px solid var(--border); margin-top: 8px; font-size: 11px; color: var(--text-muted); }
        .page-footer a { color: var(--violet); text-decoration: none; font-weight: 500; }
        .page-footer a:hover { text-decoration: underline; }

        @media (max-width: 1100px) {
            .app-shell { grid-template-columns: 1fr; padding: 16px 16px 36px; gap: 20px; }
            .sidebar { position: static; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 12px; padding: 16px 18px; border-radius: var(--radius-md); }
            .sidebar-brand .brand-icon { width: 32px; height: 32px; border-radius: 8px; font-size: 13px; }
            .sidebar-meta { flex:1; border-bottom:none; padding-bottom:0; }
            .sidebar-nav { flex-direction: row; gap: 6px; flex-wrap: wrap; width: 100%; }
            .sidebar-nav .nav-label { width: 100%; }
            .sidebar-nav a { padding: 6px 10px; font-size: 11px; }
            .sidebar-footer { width:100%; border-top:none; padding-top:0; }
            .blog-grid { grid-template-columns: repeat(2,1fr); }
            .builder-featured-grid { grid-template-columns: 1fr 1fr; }
            .signal-grid { grid-template-columns: 1fr 1fr; }
            .podcast-card { flex-direction: column; }
            .podcast-card .pc-cover-wrap { width:100%; min-height:120px; border-right:none; border-bottom:1px solid var(--border); }
        }

        @media (max-width: 767px) {
            .app-shell { padding: 10px 10px 28px; gap: 14px; }
            .sidebar { padding: 12px 14px; gap: 8px; }
            .hero-panel { padding: 22px 16px 20px; gap: 14px; border-radius: var(--radius-md); }
            .hero-title { font-size: 28px; }
            .signal-grid { grid-template-columns: 1fr; }
            .builder-featured-grid { grid-template-columns: 1fr; }
            .blog-grid { grid-template-columns: 1fr; }
            .podcast-card { flex-direction: column; }
            .podcast-card .pc-cover-wrap { width:100%; min-height:100px; border-right:none; border-bottom:1px solid var(--border); }
            .podcast-card .pc-body { padding: 14px 16px; }
            .builder-card-rich { padding: 14px 16px; }
        }

        @media (prefers-reduced-motion: reduce) {
            .hero-badge::before { animation: none; }
            * { transition-duration: 0.01ms !important; }
        }
    </style>
</head>
<body class="lang-zh">
    <div class="app-shell">
        <!-- ═══ SIDEBAR ═══ -->
        <aside class="sidebar" aria-label="Issue sidebar">
            <div class="sidebar-brand">
                <div class="brand-icon" aria-hidden="true">AI</div>
                <span class="brand-text">Builders<br>Digest</span>
            </div>
            <div class="sidebar-meta">
                <span class="issue-date">${dateStr}</span>
                AI builder 社区精选日报
            </div>
            <nav class="sidebar-nav" aria-label="In this issue">
                <span class="nav-label">本期内容</span>
                <a href="#section-x" class="nav-x">X Builder 动态 <span class="nav-badge">${stats.xBuilders}</span></a>${articlesNav}
                <a href="#section-blogs" class="nav-blog">官方博客 <span class="nav-badge">${stats.blogPosts}</span></a>
                <a href="#section-podcast" class="nav-podcast">播客 <span class="nav-badge">${stats.podcastEpisodes}</span></a>
            </nav>
            <button class="lang-toggle" onclick="toggleLang()" aria-label="切换语言" title="切换中文/English">
              <span class="lt-option active" id="lt-zh">中文</span>
              <span class="lt-option" id="lt-en">EN</span>
            </button>
            <div class="sidebar-footer">
                <a href="https://github.com/zarazhangrui/follow-builders" target="_blank" rel="noopener">Follow Builders</a>
            </div>
        </aside>

        <!-- ═══ MAIN ═══ -->
        <main class="main-content">
            <!-- Hero -->
            <section class="hero-panel" aria-labelledby="hero-heading">
                <div class="hero-badge">Daily Digest</div>
                <h1 class="hero-title" id="hero-heading">AI Builders Digest</h1>
                <p class="hero-subtitle">
                    <strong>${dateStr}</strong> · ${stats.totalTweets} 条推文 · ${stats.blogPosts} 篇博客 · ${stats.podcastEpisodes} 期播客<br>
                    AI builder 社区每日精选，给真正在 building 的人。
                </p>
                <div class="hero-stats">
                    <div class="stat-tile"><span class="stat-icon" aria-hidden="true">✕</span><span class="stat-num">${stats.xBuilders}</span><span class="stat-label">Builders</span></div>
                    <div class="stat-tile"><span class="stat-icon" aria-hidden="true">💬</span><span class="stat-num">${stats.totalTweets}</span><span class="stat-label">推文</span></div>
                    <div class="stat-tile"><span class="stat-icon" aria-hidden="true">📝</span><span class="stat-num">${stats.blogPosts}</span><span class="stat-label">博客</span></div>
                    <div class="stat-tile"><span class="stat-icon" aria-hidden="true">🎙</span><span class="stat-num">${stats.podcastEpisodes}</span><span class="stat-label">播客</span></div>
                </div>
            </section>

            <!-- Today's Signal -->
            <section class="section-panel" aria-labelledby="signal-heading">
                <div class="section-panel-header">
                    <div class="section-icon icon-signal" aria-hidden="true">⚡</div>
                    <h2 id="signal-heading">今日信号</h2>
                    <span class="section-desc">当日高亮洞察</span>
                    <span class="section-badge">${signalData.count} 条信号</span>
                </div>
                <div class="signal-grid">
                    ${signalCards}
                </div>
            </section>

            <!-- X / Twitter -->
            <section class="section-panel" id="section-x" aria-labelledby="x-heading">
                <div class="section-panel-header">
                    <div class="section-icon icon-x" aria-hidden="true">✕</div>
                    <h2 id="x-heading">Builder 动态</h2>
                    <span class="section-desc">今日活跃 AI builder 及其推文</span>
                    <span class="section-badge">${stats.xBuilders} 位</span>
                </div>
                <div class="builder-featured-grid">
                    ${featured}
                </div>
                ${compactSection}
            </section>

            ${articleSection}
            <!-- Blogs -->
            <section class="section-panel" id="section-blogs" aria-labelledby="blogs-heading">
                <div class="section-panel-header">
                    <div class="section-icon icon-blog" aria-hidden="true">📝</div>
                    <h2 id="blogs-heading">官方博客</h2>
                    <span class="section-desc">AI 实验室官方更新</span>
                    <span class="section-badge">${stats.blogPosts} 篇</span>
                </div>
                <div class="blog-grid">
                    ${blogCards}
                </div>
            </section>

            <!-- Podcast -->
            <section class="section-panel" id="section-podcast" aria-labelledby="podcast-heading">
                <div class="section-panel-header">
                    <div class="section-icon icon-podcast" aria-hidden="true">🎙</div>
                    <h2 id="podcast-heading">播客</h2>
                    <span class="section-desc">值得收听的深度对话</span>
                    <span class="section-badge">${stats.podcastEpisodes} 期</span>
                </div>
                ${podcastCards}
            </section>
        </main>
    </div>

    <script>
      function toggleLang() {
        const body = document.body;
        const isZh = body.classList.contains('lang-zh');
        if (isZh) {
          body.classList.replace('lang-zh', 'lang-en');
          document.getElementById('lt-zh').classList.remove('active');
          document.getElementById('lt-en').classList.add('active');
        } else {
          body.classList.replace('lang-en', 'lang-zh');
          document.getElementById('lt-en').classList.remove('active');
          document.getElementById('lt-zh').classList.add('active');
        }
        try { localStorage.setItem('digest-lang', body.classList.contains('lang-zh') ? 'zh' : 'en'); } catch(e){}
      }
      (function() {
        try {
          if (localStorage.getItem('digest-lang') === 'en') {
            document.body.classList.replace('lang-zh', 'lang-en');
            document.getElementById('lt-en').classList.add('active');
            document.getElementById('lt-zh').classList.remove('active');
          }
        } catch(e){}
      })();
    </script>
    <footer class="page-footer">
        <p>Generated by <a href="https://github.com/zarazhangrui/follow-builders" target="_blank" rel="noopener">Follow Builders</a></p>
        <p style="margin-top:6px;">© ${new Date().getFullYear()} AI Builders Digest</p>
    </footer>
</body>
</html>`;

  // Write output
  await writeFile(outputPath, html);
  console.log(`HTML digest written to: ${outputPath}`);
  return outputPath;
}

generate().catch(err => {
  console.error('Generation failed:', err);
  process.exit(1);
});
