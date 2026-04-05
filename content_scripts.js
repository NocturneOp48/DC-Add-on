/**
 * DC Add-on Content Script (Manifest V3)
 *
 * Features:
 *  1. User filtering (block by ID, IP with carrier presets, keyword)
 *  2. Direct view (inline post + comment preview)
 *  3. Block list editor (tabbed: ID / IP / Keyword)
 *  4. Random pick from commenters
 *  5. AJAX gallery list reload
 *  6. Auto refresh (list page only)
 *
 * All controls are in popup.html.
 * Toggles (dView, autoRefresh) use chrome.storage.local.
 * Actions (filter, edit, rPick) use chrome.runtime.onMessage.
 */

/* ================================================================
   Helpers
   ================================================================ */

const testURI = (param, url) => new RegExp(param + "=([^&#]*)").test(url);

const randomFrom = (arr) => arr[Math.floor(Math.random() * arr.length)];

const loadingHTML = `<svg class="spinner" viewBox="0 0 50 50"><circle class="path" cx="25" cy="25" r="20" fill="none" stroke-width="5"></circle></svg>`;


/* ================================================================
   Carrier IP presets (Korean mobile ISPs)
   ================================================================ */

const CARRIER_IPS = {
  SKT: [
    "203.226", "211.234", "211.235",
    "27.160", "27.161", "27.162", "27.163", "27.164", "27.165", "27.166",
    "27.167", "27.168", "27.169", "27.170", "27.171", "27.172", "27.173",
    "27.174", "27.175", "27.176", "27.177", "27.178", "27.179", "27.180",
    "27.181", "27.182", "27.183",
    "223.32", "223.33", "223.34", "223.35", "223.36", "223.37", "223.38",
    "223.39", "223.40", "223.41", "223.42", "223.43", "223.44", "223.45",
    "223.46", "223.47", "223.48", "223.49", "223.50", "223.51", "223.52",
    "223.53", "223.54", "223.55", "223.56", "223.57", "223.58", "223.59",
    "223.60", "223.61", "223.62", "223.63",
    "42.35", "42.36",
  ],
  KT: [
    "39.7", "110.70", "175.223", "211.246",
    "118.235",
  ],
  "LG U+": [
    "61.43", "106.101", "106.102", "125.188",
    "117.111", "211.36",
  ],
};

/* ================================================================
   Storage  (localStorage for block lists, chrome.storage for toggles)
   ================================================================ */

function loadBlockData() {
  try {
    const raw = JSON.parse(localStorage.getItem("dca_block"));
    return {
      ids: Array.isArray(raw?.ids) ? raw.ids : [],
      ips: Array.isArray(raw?.ips) ? raw.ips : [],
      keywords: Array.isArray(raw?.keywords) ? raw.keywords : [],
    };
  } catch {
    return { ids: [], ips: [], keywords: [] };
  }
}

function saveBlockData(data) {
  localStorage.setItem("dca_block", JSON.stringify(data));
}

// Migrate old format → new format (one-time)
function migrateOldData() {
  const oldRaw = localStorage.getItem("filter_users");
  if (!oldRaw) return;
  try {
    const old = JSON.parse(oldRaw);
    if (!old || typeof old !== "object") return;
    const current = loadBlockData();
    for (const [val, key] of Object.entries(old)) {
      if (key === "data-uid" && !current.ids.includes(val)) {
        current.ids.push(val);
      } else if (key === "data-ip" && !current.ips.includes(val)) {
        current.ips.push(val);
      }
    }
    saveBlockData(current);
    localStorage.removeItem("filter_users");
  } catch { /* ignore */ }
}

migrateOldData();
let blockData = loadBlockData();

/* ================================================================
   Filtering
   ================================================================ */

function filterPosts() {
  blockData = loadBlockData();

  const idSet = new Set(blockData.ids);
  const ipPrefixes = blockData.ips;
  const keywords = blockData.keywords;

  // Filter post rows (list page)
  for (const writer of $.all(".ub-content .ub-writer")) {
    const row = writer.closest(".ub-content");
    if (!row) continue;

    // ID match
    const uid = writer.getAttribute("data-uid");
    if (uid && idSet.has(uid)) { row.style.display = "none"; continue; }

    // IP prefix match
    const ip = writer.getAttribute("data-ip");
    if (ip && ipPrefixes.some((p) => ip.startsWith(p))) { row.style.display = "none"; continue; }

    // Keyword match on title
    if (keywords.length > 0) {
      const titleEl = row.querySelector(".gall_tit a");
      const title = titleEl ? titleEl.textContent : "";
      if (keywords.some((kw) => title.includes(kw))) { row.style.display = "none"; continue; }
    }
  }

  // Filter comments
  filterComments();
}

function filterComments() {
  const idSet = new Set(blockData.ids);
  const ipPrefixes = blockData.ips;
  const keywords = blockData.keywords;

  for (const cmt of $.all(".cmt_info")) {
    const li = cmt.closest("li");
    if (!li) continue;

    const writer = cmt.querySelector(".ub-writer");
    if (writer) {
      const uid = writer.getAttribute("data-uid");
      if (uid && idSet.has(uid)) { li.style.display = "none"; continue; }

      const ip = writer.getAttribute("data-ip");
      if (ip && ipPrefixes.some((p) => ip.startsWith(p))) { li.style.display = "none"; continue; }
    }

    // Keyword match on comment text
    if (keywords.length > 0) {
      const textEl = cmt.querySelector(".usertxt");
      const text = textEl ? textEl.textContent : "";
      if (keywords.some((kw) => text.includes(kw))) { li.style.display = "none"; continue; }
    }
  }
}

/* ================================================================
   UI: Block list editor (tabbed modal)
   ================================================================ */

function openEditView() {
  return new Promise((resolve) => {
    blockData = loadBlockData();

    const el = $.el(`
      <div class="dca-overlay">
        <div class="dca-modal" style="width:560px">
          <div class="dca-modal-header">
            <h2 class="dca-modal-title">차단 목록</h2>
            <p class="dca-modal-desc">차단할 대상을 관리하세요</p>
          </div>
          <div class="dca-modal-body" style="padding-top:12px">
            <div class="dca-tabs">
              <button class="dca-tab active" data-tab="ids">유저 ID</button>
              <button class="dca-tab" data-tab="ips">유저 IP</button>
              <button class="dca-tab" data-tab="keywords">키워드</button>
            </div>
            <div class="dca-tab-panel active" data-panel="ids">
              <p class="dca-tab-desc">차단할 유저 ID를 한 줄에 하나씩 입력하세요</p>
              <textarea class="dca-textarea dca-tab-textarea" data-key="ids">${blockData.ids.join("\n")}</textarea>
            </div>
            <div class="dca-tab-panel" data-panel="ips">
              <p class="dca-tab-desc">차단할 IP 프리픽스를 한 줄에 하나씩 입력하세요 (예: 175.223)</p>
              <div class="dca-carrier-btns">
                <span class="dca-carrier-label">통신사 일괄 차단:</span>
                <button class="dca-btn dca-btn-secondary dca-btn-sm dca-carrier" data-carrier="SKT">SKT</button>
                <button class="dca-btn dca-btn-secondary dca-btn-sm dca-carrier" data-carrier="KT">KT</button>
                <button class="dca-btn dca-btn-secondary dca-btn-sm dca-carrier" data-carrier="LG U+">LG U+</button>
              </div>
              <textarea class="dca-textarea dca-tab-textarea" data-key="ips">${blockData.ips.join("\n")}</textarea>
            </div>
            <div class="dca-tab-panel" data-panel="keywords">
              <p class="dca-tab-desc">차단할 키워드를 한 줄에 하나씩 입력하세요. 글 제목과 댓글에 적용됩니다.</p>
              <textarea class="dca-textarea dca-tab-textarea" data-key="keywords">${blockData.keywords.join("\n")}</textarea>
            </div>
          </div>
          <div class="dca-modal-footer">
            <button type="button" class="dca-btn dca-btn-secondary cancel">취소</button>
            <button type="button" class="dca-btn dca-btn-primary ok">저장</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(el);

    // Tab switching
    for (const tab of $.findAll(".dca-tab", el)) {
      tab.addEventListener("click", () => {
        for (const t of $.findAll(".dca-tab", el)) t.classList.remove("active");
        for (const p of $.findAll(".dca-tab-panel", el)) p.classList.remove("active");
        tab.classList.add("active");
        const panel = $.find(`[data-panel="${tab.dataset.tab}"]`, el);
        if (panel) panel.classList.add("active");
      });
    }

    // Carrier preset buttons
    for (const btn of $.findAll(".dca-carrier", el)) {
      btn.addEventListener("click", () => {
        const carrier = btn.dataset.carrier;
        const prefixes = CARRIER_IPS[carrier];
        if (!prefixes) return;
        const ta = $.find('[data-key="ips"]', el);
        const current = new Set(ta.value.split("\n").map((s) => s.trim()).filter(Boolean));
        for (const p of prefixes) current.add(p);
        ta.value = [...current].join("\n");
        // Visual feedback
        btn.textContent = btn.dataset.carrier + " ✓";
        setTimeout(() => { btn.textContent = btn.dataset.carrier; }, 1000);
      });
    }

    // Close on overlay click
    el.addEventListener("click", (e) => {
      if (e.target === el) { $.remove(el); resolve(false); }
    });

    $.find(".cancel", el).addEventListener("click", () => {
      $.remove(el);
      resolve(false);
    });

    $.find(".ok", el).addEventListener("click", () => {
      const parse = (key) => {
        const ta = $.find(`[data-key="${key}"]`, el);
        return ta.value.split("\n").map((s) => s.trim()).filter(Boolean);
      };
      blockData = {
        ids: parse("ids"),
        ips: parse("ips"),
        keywords: parse("keywords"),
      };
      saveBlockData(blockData);
      $.remove(el);
      resolve(true);
      filterPosts();
    });
  });
}

/* ================================================================
   UI: Random pick dialog
   ================================================================ */

function showRandomPick(title, users) {
  return new Promise((resolve) => {
    const el = $.el(`
      <div class="dca-overlay">
        <div class="dca-modal" style="width:500px">
          <div class="dca-modal-header">
            <h2 class="dca-modal-title">${title}</h2>
            <p class="dca-modal-desc">${users.size > 0
              ? "댓글 작성자가 자동으로 추가되었습니다. 확인 후 추첨하세요."
              : "글 보기 화면에서 열면 댓글 작성자가 자동으로 추가됩니다."}</p>
          </div>
          <div class="dca-modal-body">
            <div class="dca-badge-container"></div>
            <div class="dca-input-row">
              <input type="text" class="dca-input" id="input_user" placeholder="닉네임 입력">
              <button class="dca-btn dca-btn-secondary dca-btn-sm" id="submit">추가</button>
            </div>
            <div class="dca-result" style="display:none">
              <div class="dca-result-label">당첨자</div>
              <div class="dca-result-value" id="win"></div>
            </div>
          </div>
          <div class="dca-modal-footer">
            <button type="button" class="dca-btn dca-btn-secondary cancel">종료</button>
            <button type="button" class="dca-btn dca-btn-destructive start">추첨</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(el);

    const container = $.find(".dca-badge-container", el);

    function addUserBtn(name) {
      if (!name) return;
      const badge = $.el(
        `<span class="dca-badge" data-user="${name}">${name}<span class="dca-badge-x">&times;</span></span>`
      );
      container.appendChild(badge);
    }

    for (const name of users) addUserBtn(name);

    $.delegate(container, "click", ".dca-badge-x", (_e, target) => {
      $.remove(target.closest(".dca-badge"));
    });

    const inputEl = $.find("#input_user", el);
    const addFromInput = () => {
      addUserBtn(inputEl.value.trim());
      inputEl.value = "";
      inputEl.focus();
    };
    $.find("#submit", el).addEventListener("click", addFromInput);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addFromInput();
    });

    $.find(".start", el).addEventListener("click", () => {
      const items = $.findAll(".dca-badge", el).map((b) => b.dataset.user);
      if (items.length === 0) return;
      const winner = randomFrom(items);
      const resultBox = $.find(".dca-result", el);
      resultBox.style.display = "";
      $.find("#win", el).textContent = winner;
    });

    el.addEventListener("click", (e) => {
      if (e.target === el) { $.remove(el); resolve(false); }
    });

    $.find(".cancel", el).addEventListener("click", () => {
      $.remove(el);
      resolve(false);
    });
  });
}

/* ================================================================
   Feature: Random pick
   ================================================================ */

async function openRandomPick() {
  const nickSet = new Set();
  for (const el of $.all(".cmt_nickbox .ub-writer")) {
    const nick = el.getAttribute("data-nick");
    if (!nick || nick === "댓글돌이") continue;
    const ip = el.getAttribute("data-ip");
    nickSet.add(ip ? `${nick}(${ip})` : nick);
  }

  await showRandomPick("추첨목록", nickSet);
}

/* ================================================================
   Feature: Direct View (inline post preview)
   ================================================================ */

let dViewMode = false;

function setDViewMode(on) {
  dViewMode = on;
  if (dViewMode) initDirectView();
}

function extractPostContent(html) {
  const m = html.match(
    /<div class="view_content_wrap">[\s\S]*?(?=<!-- 댓글 -->)/
  );
  return m ? m[0] : null;
}

function extractComments(html) {
  const m = html.match(
    /<div class="view_comment" id="focus_cmt" tabindex="0">[\s\S]*?(?=<script id="reply-setting-tmpl")/
  );
  return m ? m[0] : null;
}

function closeDialog() {
  const dialog = $("#dcs_dialog");
  const pos = $("#dlg_position");
  if (dialog) $.remove(dialog);
  if (pos) $.remove(pos);
}

function initDirectView() {
  for (const link of $.all(".ub-content.us-post a")) {
    if (link.dataset.dvBound) continue;
    link.dataset.dvBound = "1";

    link.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const rawHref = link.getAttribute("href");
      const href = rawHref.replace(/^http:\/\//, "https://");

      if (!dViewMode) {
        window.location.href = href;
        return;
      }

      closeDialog();

      const postRow = link.closest(".us-post");
      const posRow = $.el(`<tr id="dlg_position"></tr>`);
      $.after(postRow, posRow);

      const dialog = $.el(`<div id="dcs_dialog"></div>`);
      posRow.appendChild(dialog);

      try {
        history.replaceState({ data: "replace" }, "title", href);
      } catch {
        const url = new URL(href, location.origin);
        history.replaceState({ data: "replace" }, "title", url.pathname + url.search);
      }

      try {
        const html = await $.get(href);
        const postHtml = extractPostContent(html);
        const cmtHtml = extractComments(html);

        if (postHtml) dialog.appendChild($.el(postHtml));

        $.animate({ top: "0px", opacity: "1" }, dialog);

        const hrefUrl = new URL(href, location.origin);
        const galleryId = hrefUrl.searchParams.get("id");
        const articleNo = hrefUrl.searchParams.get("no");

        const esnoMatch = html.match(/name="e_s_n_o"[^>]*value="([^"]*)"/);
        if (esnoMatch) {
          const esnoEl = document.getElementById("e_s_n_o");
          if (esnoEl) esnoEl.value = esnoMatch[1];
        }
        const triggerViewComments = () => {
          document.dispatchEvent(new CustomEvent("__dc_addon_viewComments", {
            detail: { gallery_id: galleryId, no: articleNo }
          }));
        };

        if (cmtHtml) dialog.appendChild($.el(cmtHtml));

        setTimeout(() => {
          const iframe = $.el(
            `<iframe id="dcs_iframe" style="display:none" src="${href}"></iframe>`
          );
          dialog.appendChild(iframe);
        }, 1000);

        const replyBtn = $.find(".repley_add", dialog);
        if (replyBtn) {
          replyBtn.classList.remove("btn_blue", "btn_svc", "small", "repley_add");
          replyBtn.classList.add("btn_blue", "small", "dcs_replyButton");
        }

        const memo = $.find('textarea[id^="memo"]', dialog);
        if (memo) memo.classList.add("directMemobox");

        triggerViewComments();

        for (const img of $.findAll("img[data-original]", dialog)) {
          img.src = img.getAttribute("data-original");
        }

        setTimeout(filterPosts, 300);

        const memoBox = $.find("textarea.directMemobox", dialog);
        if (memoBox) {
          memoBox.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              const btn = $.find(".dcs_replyButton", dialog);
              if (btn) btn.click();
            }
          });
        }

        $.delegate(dialog, "click", ".tx_dccon", () => {
          const divCon = $.find("#div_con", dialog);
          if (divCon) {
            divCon.classList.toggle("off");
          } else {
            const iframe = $.find("#dcs_iframe", dialog);
            if (iframe && iframe.contentDocument) {
              const iframeCon = iframe.contentDocument.body.querySelector("#div_con");
              if (iframeCon) {
                const dcconBox = $.find(".dccon_guidebox", dialog);
                if (dcconBox) dcconBox.appendChild(iframeCon);
              }
            }
          }
        });

        const dcsReplyBtn = $.find(".dcs_replyButton", dialog);
        if (dcsReplyBtn) {
          dcsReplyBtn.addEventListener("click", () => {
            commentViaIframe(dialog);
          });
        }
      } catch (err) {
        console.error("[dc add-on] Direct view load failed:", err);
      }
    });
  }

  const wrapInner = $(".wrap_inner");
  if (wrapInner && !wrapInner.dataset.dvCloseBound) {
    wrapInner.dataset.dvCloseBound = "1";
    wrapInner.addEventListener("click", (e) => {
      if (e.target.closest(".gall_list") || e.target.closest("#dcs_dialog")) return;
      closeDialog();
    });
  }

  if (!document.documentElement.dataset.dvEscBound) {
    document.documentElement.dataset.dvEscBound = "1";
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDialog();
    });
  }
}

function commentViaIframe(dialog) {
  const iframe = $.find("#dcs_iframe", dialog);
  if (!iframe || !iframe.contentDocument) return;

  const iframeBody = iframe.contentDocument.body;
  const nameInput = $.find("input[id^='name']", dialog);
  const pwInput = $.find("input[id^='password']", dialog);
  const textArea = $.find("textarea.directMemobox", dialog);
  if (!textArea) return;

  const text = textArea.value;

  if (pwInput) {
    const iframeName = iframeBody.querySelector("input[id^='name']");
    const iframePw = iframeBody.querySelector("input[id^='password']");
    if (iframeName && nameInput) iframeName.value = nameInput.value;
    if (iframePw) iframePw.value = pwInput.value;
  }

  const iframeTextarea = iframeBody.querySelector(".cmt_write_box textarea");
  if (iframeTextarea) {
    iframeTextarea.focus();
    iframeTextarea.value = text;
  }

  const countBtn = iframeBody.querySelector(".comment_count");
  if (countBtn) countBtn.click();

  const submitBtn = iframeBody.querySelector(".btn_blue.btn_svc.small.repley_add");
  if (submitBtn) submitBtn.click();

  document.dispatchEvent(new CustomEvent("__dc_addon_viewComments"));

  setTimeout(filterPosts, 300);
  textArea.value = "";
}

/* ================================================================
   Feature: AJAX gallery list reload
   ================================================================ */

/* Helper: get the base list URL (strip mode/tab params) for gallery title reload */
function getBaseListUrl() {
  const url = new URL(location.href);
  url.searchParams.delete("exception_mode");
  url.searchParams.delete("search_head");
  url.searchParams.delete("page");
  return url.href;
}

/* Helper: get the current list URL respecting 개념글 mode + 말머리 tab.
   Reads from hidden inputs (DC's own state) as source of truth. */
function getCurrentListUrl() {
  const url = new URL(location.href);

  // 개념글 mode
  const exMode = document.getElementById("exception_mode");
  if (exMode && exMode.value && exMode.value !== "all") {
    url.searchParams.set("exception_mode", exMode.value);
  } else {
    url.searchParams.delete("exception_mode");
  }

  // 말머리 tab (search_head)
  const searchHead = document.getElementById("search_head");
  if (searchHead && searchHead.value && searchHead.value !== "all" && searchHead.value !== "0") {
    url.searchParams.set("search_head", searchHead.value);
  } else if (!url.searchParams.has("search_head")) {
    // keep URL param if already present
  }

  return url.href;
}

function initGallReload() {
  const href = document.location.href;

  if (testURI("no", href) || testURI("s_type", href)) return;

  const gallLink = $(".page_head > .fl a");
  if (!gallLink) return;

  gallLink.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    closeDialog();

    const fl = $(".page_head > .fl");
    if (fl) fl.appendChild($.el(loadingHTML));

    // Always go back to normal (전체글) mode
    const targetHref = getBaseListUrl();
    history.replaceState({ data: "replace" }, "title", targetHref);

    try {
      const html = await $.get(targetHref);
      const match = html.match(
        /<table class="gall_list[\s]*">([\s\S]*?)<\/table>/
      );
      if (match) {
        const gallList = $(".gall_list");
        if (gallList) gallList.innerHTML = match[1];
      }

      // Reset 개념글 and 말머리 tab state
      const exModeInput = document.getElementById("exception_mode");
      if (exModeInput) exModeInput.value = "";
      const searchHeadInput = document.getElementById("search_head");
      if (searchHeadInput) searchHeadInput.value = "";

      filterPosts();
      if (dViewMode) initDirectView();
    } catch (err) {
      console.error("[dc add-on] Gallery reload failed:", err);
    } finally {
      const spinner = $(".spinner");
      if (spinner) $.remove(spinner);
    }
  });
}

/* ================================================================
   Feature: Auto Refresh (list page only)
   ================================================================ */

let autoRefreshOn = false;
let autoRefreshTimer = null;
let autoRefreshInterval = 10_000;

function setAutoRefresh(on) {
  autoRefreshOn = on;
  if (autoRefreshOn) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
}

function setRefreshInterval(seconds) {
  autoRefreshInterval = (seconds || 10) * 1000;
  if (autoRefreshOn) {
    stopAutoRefresh();
    startAutoRefresh();
  }
}

function startAutoRefresh() {
  if (autoRefreshTimer) return;
  autoRefreshTimer = setInterval(doAutoRefresh, autoRefreshInterval);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

async function doAutoRefresh() {
  const gallList = $(".gall_list tbody");
  if (!gallList) return;

  const isNotice = (row) => row.dataset.type === "icon_notice";

  const existingNos = new Set();
  for (const row of $.all(".gall_list .ub-content.us-post")) {
    if (isNotice(row)) continue;
    const no = row.dataset.no;
    if (no) existingNos.add(no);
  }

  // Build fetch URL reflecting current list mode (개념글, 말머리 탭, etc.)
  const fetchUrl = getCurrentListUrl();

  try {
    const html = await $.get(fetchUrl);
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    const fetchedRows = tpl.content.querySelectorAll(".gall_list .ub-content.us-post");

    const newRows = [];
    for (const row of fetchedRows) {
      if (isNotice(row)) continue;
      const no = row.dataset.no;
      if (no && !existingNos.has(no)) {
        newRows.push(row);
      }
    }

    if (newRows.length === 0) return;

    let insertBefore = null;
    for (const row of gallList.querySelectorAll(".ub-content.us-post")) {
      if (!isNotice(row)) {
        insertBefore = row;
        break;
      }
    }
    if (!insertBefore) return;

    for (const row of newRows.reverse()) {
      row.style.backgroundColor = "var(--dc-muted, #f4f4f5)";
      row.style.transition = "background-color 5s ease";
      gallList.insertBefore(row, insertBefore);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          row.style.backgroundColor = "";
        });
      });
    }

    filterPosts();
    if (dViewMode) initDirectView();
  } catch {
    // Silently ignore fetch errors
  }
}

/* ================================================================
   Message listener (popup → content script)
   ================================================================ */

chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.action) {
    case "edit":
      openEditView();
      break;
    case "rPick":
      openRandomPick();
      break;
  }
});

/* ================================================================
   Storage listener (popup toggle changes)
   ================================================================ */

chrome.storage.onChanged.addListener((changes) => {
  if (changes.dViewMode) {
    setDViewMode(!!changes.dViewMode.newValue);
  }
  if (changes.refreshInterval) {
    setRefreshInterval(changes.refreshInterval.newValue);
  }
  if (changes.autoRefreshMode) {
    setAutoRefresh(!!changes.autoRefreshMode.newValue);
  }
});

/* ================================================================
   Init
   ================================================================ */

(function init() {
  chrome.storage.local.get(["dViewMode", "autoRefreshMode", "refreshInterval"], (data) => {
    setDViewMode(!!data.dViewMode);
    if (data.refreshInterval) setRefreshInterval(data.refreshInterval);

    const href = document.location.href;
    const isListPage = !testURI("no", href) && !testURI("s_type", href);
    if (isListPage) {
      setAutoRefresh(!!data.autoRefreshMode);
    }
  });

  filterPosts();

  const href = document.location.href;
  if (!testURI("s_type", href) && !testURI("no", href)) {
    initGallReload();
  }
})();
