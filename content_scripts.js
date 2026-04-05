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

function closeDialog(skipScroll) {
  const dialog = $("#dcs_dialog");
  const pos = $("#dlg_position");
  // Find the post row that was being viewed (right before dlg_position)
  const viewedRow = pos ? pos.previousElementSibling : null;
  if (dialog) $.remove(dialog);
  if (pos) $.remove(pos);
  stopCommentRefresh();
  // Scroll so the viewed post sits at ~30% from top of viewport (only when closing without opening another)
  if (!skipScroll && viewedRow) {
    const rect = viewedRow.getBoundingClientRect();
    const target = window.scrollY + rect.top - window.innerHeight * 0.3;
    window.scrollTo({ top: target, behavior: "smooth" });
  }
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

      closeDialog(true);

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

        postRow.scrollIntoView({ block: "start" });
        $.animate({ top: "0px", opacity: "1" }, dialog);

        const hrefUrl = new URL(href, location.origin);
        const galleryId = hrefUrl.searchParams.get("id");
        const articleNo = hrefUrl.searchParams.get("no");

        const esnoMatch = html.match(/name="e_s_n_o"[^>]*value="([^"]*)"/);
        if (esnoMatch) {
          const esnoEl = document.getElementById("e_s_n_o");
          if (esnoEl) esnoEl.value = esnoMatch[1];
        }

        // Extract hidden inputs needed for captcha (non-logged-in users)
        const kcaptchaMatch = html.match(/id="kcaptcha_use"[^>]*value="([^"]*)"/);
        if (kcaptchaMatch) {
          let kcEl = document.getElementById("kcaptcha_use");
          if (!kcEl) {
            kcEl = document.createElement("input");
            kcEl.type = "hidden";
            kcEl.id = "kcaptcha_use";
            document.body.appendChild(kcEl);
          }
          kcEl.value = kcaptchaMatch[1];
        }

        // Ensure #id input exists (needed by kcaptcha.js)
        if (!document.getElementById("id")) {
          const idInput = document.createElement("input");
          idInput.type = "hidden";
          idInput.id = "id";
          idInput.value = galleryId;
          document.body.appendChild(idInput);
        }
        const triggerViewComments = () => {
          document.dispatchEvent(new CustomEvent("__dc_addon_viewComments", {
            detail: { gallery_id: galleryId, no: articleNo }
          }));
        };

        if (cmtHtml) dialog.appendChild($.el(cmtHtml));

        // Load iframe for comment submission (uses server-issued tokens)
        const iframe = $.el(
          `<iframe id="dcs_iframe" style="display:none" src="${href}"></iframe>`
        );
        iframe.addEventListener("load", () => {
          try {
            const iframeBody = iframe.contentDocument.body;
            // Sync captcha image from iframe to dialog (same cookie session)
            const iframeCaptcha = iframeBody.querySelector("img.kcaptcha[data-type='comment']");
            const dialogCaptcha = $.find("img.kcaptcha[data-type='comment']", dialog);
            if (iframeCaptcha && dialogCaptcha) {
              const syncCaptcha = () => {
                if (iframeCaptcha.src && !iframeCaptcha.src.includes("kcap_none")) {
                  dialogCaptcha.src = iframeCaptcha.src;
                } else {
                  setTimeout(syncCaptcha, 300);
                }
              };
              setTimeout(syncCaptcha, 200);

              // Bug fix 1: captcha click refresh
              dialogCaptcha.style.cursor = "pointer";
              dialogCaptcha.addEventListener("click", () => {
                iframeCaptcha.click();
                setTimeout(() => {
                  dialogCaptcha.src = iframeCaptcha.src;
                }, 300);
              });
            }

            // Bug fix 2: restore saved password from localStorage
            const savedPw = localStorage.getItem("nonmember_pw");
            if (savedPw) {
              const pwInput = $.find("input[name='password']", dialog);
              if (pwInput && !pwInput.value) pwInput.value = savedPw;
            }
          } catch { /* cross-origin */ }
        });
        dialog.appendChild(iframe);

        // Replace submit button to use iframe-based submission
        const replyBtn = $.find(".repley_add", dialog);
        if (replyBtn) {
          replyBtn.classList.remove("repley_add");
          replyBtn.classList.add("dcs_replyButton");
          replyBtn.addEventListener("click", () => commentViaIframe(dialog));
        }
        const replyBtnVote = $.find(".repley_add_vote", dialog);
        if (replyBtnVote) {
          replyBtnVote.classList.remove("repley_add_vote");
          replyBtnVote.classList.add("dcs_replyButtonVote");
          replyBtnVote.addEventListener("click", () => commentViaIframe(dialog));
        }

        // Bug fix 3: Enter key submits comment
        const memoBox = $.find("textarea[id^='memo']", dialog);
        if (memoBox) {
          memoBox.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commentViaIframe(dialog);
            }
          });
        }

        // Dccon button: click iframe's .tx_dccon, show iframe as overlay
        // with only #div_con visible, so all dccon.js interactions work natively
        $.delegate(dialog, "click", ".tx_dccon", (e, target) => {
          e.preventDefault();
          e.stopPropagation();
          const iframeEl = dialog.querySelector("#dcs_iframe");
          if (!iframeEl || !iframeEl.contentDocument) return;

          // If iframe overlay is already showing, toggle it off
          if (iframeEl.dataset.dcconVisible === "1") {
            hideDcconOverlay(iframeEl);
            startCommentRefresh();
            return;
          }

          // Stop auto-refresh while dccon overlay is open (prevents captcha invalidation)
          stopCommentRefresh();

          try {
            const iframeDoc = iframeEl.contentDocument;
            // Click matching .tx_dccon in iframe to trigger dccon.js
            const dataNo = target.getAttribute("data-no");
            const iframeBtn = dataNo
              ? iframeDoc.body.querySelector(".tx_dccon[data-no='" + dataNo + "']")
              : iframeDoc.body.querySelector(".tx_dccon");
            if (iframeBtn) iframeBtn.click();

            // Wait for #div_con to become visible, then show iframe overlay
            const waitForDccon = (attempts) => {
              if (attempts <= 0) return;
              const iframeDivCon = iframeDoc.getElementById("div_con");
              if (!iframeDivCon || iframeDivCon.style.display === "none") {
                setTimeout(() => waitForDccon(attempts - 1), 200);
                return;
              }
              showDcconOverlay(iframeEl, iframeDivCon, target);
            };
            setTimeout(() => waitForDccon(15), 300);
          } catch { /* cross-origin */ }
        });

        triggerViewComments();
        startCommentRefresh();

        for (const img of $.findAll("img[data-original]", dialog)) {
          img.src = img.getAttribute("data-original");
        }

        setTimeout(filterPosts, 300);
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

/* ================================================================
   Dccon overlay helpers (direct view)
   Show iframe as a positioned overlay displaying only #div_con
   ================================================================ */

function showDcconOverlay(iframeEl, iframeDivCon, triggerBtn) {
  const iframeDoc = iframeEl.contentDocument;
  const iframeBody = iframeDoc.body;
  const dialog = triggerBtn.closest("#dcs_dialog");

  // Move #div_con to body root so we can hide everything else
  iframeBody.appendChild(iframeDivCon);

  let dcconStyle = iframeDoc.getElementById("dcs_dccon_style");
  if (!dcconStyle) {
    dcconStyle = iframeDoc.createElement("style");
    dcconStyle.id = "dcs_dccon_style";
    iframeDoc.head.appendChild(dcconStyle);
  }
  dcconStyle.textContent = [
    "html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; }",
    "body > *:not(#div_con) { display: none !important; }",
    "#div_con { display: block !important; position: static !important; }",
  ].join("\n");

  // Calculate position relative to dialog
  const btnRect = triggerBtn.getBoundingClientRect();
  const dialogRect = dialog.getBoundingClientRect();
  const offsetTop = btnRect.bottom - dialogRect.top;

  iframeEl.style.display = "block";
  iframeEl.style.position = "absolute";
  iframeEl.style.left = "0px";
  iframeEl.style.top = offsetTop + "px";
  iframeEl.style.width = "840px";
  iframeEl.style.border = "1px solid #ccc";
  iframeEl.style.borderRadius = "4px";
  iframeEl.style.zIndex = "999";
  iframeEl.style.background = "#fff";
  iframeEl.style.boxShadow = "0 4px 16px rgba(0,0,0,0.15)";
  iframeEl.scrolling = "no";
  iframeEl.dataset.dcconVisible = "1";
  iframeEl.contentWindow.scrollTo(0, 0);

  // Sync dialog inputs → iframe so dccon.js can read name/pw/code
  const syncInputs = () => {
    try {
      const textArea = dialog.querySelector("textarea[id^='memo']");
      const no = textArea ? textArea.id.replace("memo_", "") : "";
      if (!no) return;
      const fields = [
        ["#name_" + no, "input[name='name']"],
        ["#password_" + no, "input[name='password']"],
        ["#code_" + no, "#code_" + no],
        ["#gall_nick_name_" + no, "input[name='gall_nick_name']"],
      ];
      for (const [iframeSel, dialogSel] of fields) {
        const iframeInput = iframeDoc.querySelector(iframeSel);
        const dialogInput = dialog.querySelector(dialogSel);
        if (iframeInput && dialogInput) {
          iframeInput.value = dialogInput.value;
        }
      }
      const iframeUGN = iframeDoc.querySelector("#use_gall_nick");
      const dialogUGN = dialog.querySelector("#use_gall_nick") || document.querySelector("#use_gall_nick");
      if (iframeUGN && dialogUGN) iframeUGN.value = dialogUGN.value;
    } catch {}
  };

  // Size iframe to match #div_con height, keep #div_con at body root
  const fitToContent = () => {
    try {
      if (iframeDivCon.parentElement !== iframeBody) {
        iframeBody.appendChild(iframeDivCon);
      }
      iframeEl.contentWindow.scrollTo(0, 0);
      const h = iframeDivCon.offsetHeight;
      if (h > 0) iframeEl.style.height = h + "px";
      syncInputs();
    } catch {}
  };
  fitToContent();
  setTimeout(fitToContent, 200);
  setTimeout(fitToContent, 600);

  // Intercept dccon.js's insert_icon AJAX call:
  // dccon.js moves #div_con to body, breaking .parents('.dccon_guidebox') traversal.
  // We hook iframe's jQuery.ajax so that when dccon.js POSTs to /dccon/insert_icon,
  // we cancel it and re-submit from the parent page with correct data.
  hookDcconAjax(iframeEl);

  // Sync inputs right before dccon.js handles .img_dccon click (capture phase)
  iframeDivCon.addEventListener("click", (evt) => {
    if (evt.target.closest(".img_dccon")) syncInputs();
  }, true);

  // Re-fit when dccon.js changes content (tab switch, pagination, AJAX load)
  const resizeObs = new MutationObserver(() => setTimeout(fitToContent, 50));
  resizeObs.observe(iframeBody, { childList: true, subtree: true, attributes: true });

  // Watch for dccon.js hiding #div_con (icon selected or closed)
  const styleObs = new MutationObserver(() => {
    try {
      if (iframeDivCon.style.display === "none") {
        styleObs.disconnect();
        resizeObs.disconnect();
        hideDcconOverlay(iframeEl);
        startCommentRefresh();
        setTimeout(() => {
          document.dispatchEvent(new CustomEvent("__dc_addon_viewComments", {
            detail: { refreshOnly: true }
          }));
          setTimeout(filterComments, 500);
        }, 500);
      }
    } catch {
      styleObs.disconnect();
      resizeObs.disconnect();
    }
  });
  styleObs.observe(iframeDivCon, { attributes: true, attributeFilter: ["style"] });
}

/**
 * Hook iframe's jQuery.ajax to intercept dccon insert_icon calls.
 * dccon.js's own AJAX fails with "fail2" because moving #div_con to body
 * breaks DOM context. Instead, we let dccon.js build the formData (which
 * reads tokens from iframe DOM), but intercept the actual AJAX call and
 * re-submit it from the parent context.
 */
function hookDcconAjax(iframeEl) {
  try {
    const iframeWin = iframeEl.contentWindow;
    const iframe$ = iframeWin.jQuery || iframeWin.$;
    if (!iframe$ || iframe$._dcaHooked) return;
    iframe$._dcaHooked = true;

    const origAjax = iframe$.ajax;
    iframe$.ajax = function (opts) {
      // Only intercept dccon insert_icon calls
      if (opts && opts.url && opts.url.indexOf("/dccon/insert_icon") !== -1) {
        // dccon.js built formData from iframe DOM — just forward it as-is
        // but send from parent page context (same origin, same cookies)
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "https://" + location.host + "/dccon/insert_icon", true);
        xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
        xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
        xhr.onload = function () {
          if (opts.success) opts.success(xhr.responseText);
        };
        xhr.onerror = function () {
          if (opts.error) opts.error();
        };
        xhr.send(opts.data);
        return xhr;
      }
      return origAjax.apply(this, arguments);
    };
  } catch {}
}

function hideDcconOverlay(iframeEl) {
  iframeEl.style.display = "none";
  iframeEl.dataset.dcconVisible = "0";
  try {
    const doc = iframeEl.contentDocument;
    const s = doc.getElementById("dcs_dccon_style");
    if (s) s.textContent = "";
  } catch {}
}

function commentViaIframe(dialog) {
  const iframe = $.find("#dcs_iframe", dialog);
  if (!iframe || !iframe.contentDocument) return;

  const iframeBody = iframe.contentDocument.body;
  const textArea = $.find("textarea[id^='memo']", dialog);
  if (!textArea || !textArea.value.trim()) return;

  // Transfer values to iframe inputs
  const no = textArea.id.replace("memo_", "");

  // Nickname (갤닉네임 or regular)
  const gallNick = $.find("input[name='gall_nick_name']", dialog);
  const nameInput = $.find("input[name='name']", dialog);
  const pwInput = $.find("input[name='password']", dialog);
  const codeInput = document.getElementById("code_" + no);

  const iGallNick = iframeBody.querySelector("input[name='gall_nick_name']");
  const iName = iframeBody.querySelector("input[name='name']");
  const iPw = iframeBody.querySelector("input[name='password']");
  const iCode = iframeBody.querySelector("#code_" + no);
  const iMemo = iframeBody.querySelector("#memo_" + no);
  const iUseGallNick = iframeBody.querySelector("#use_gall_nick");

  // Sync use_gall_nick state
  const useGallNick = document.getElementById("use_gall_nick");
  if (useGallNick && iUseGallNick) iUseGallNick.value = useGallNick.value;

  if (gallNick && iGallNick) iGallNick.value = gallNick.value;
  if (nameInput && iName) iName.value = nameInput.value;
  if (pwInput && iPw) iPw.value = pwInput.value;
  if (codeInput && iCode) iCode.value = codeInput.value;
  if (iMemo) iMemo.value = textArea.value;

  // Click iframe's submit button
  const submitBtn = iframeBody.querySelector(".repley_add[data-no='" + no + "']");
  if (submitBtn) submitBtn.click();

  // Refresh comments and clear input
  setTimeout(() => {
    document.dispatchEvent(new CustomEvent("__dc_addon_viewComments", {
      detail: { refreshOnly: true }
    }));
    textArea.value = "";
    // Reload captcha for next comment
    try {
      const iframeCaptcha = iframeBody.querySelector("img.kcaptcha[data-type='comment']");
      const dialogCaptcha = $.find("img.kcaptcha[data-type='comment']", dialog);
      if (iframeCaptcha && dialogCaptcha) {
        // Trigger iframe captcha reload by clicking it
        if (iframeCaptcha.click) iframeCaptcha.click();
        setTimeout(() => {
          if (iframeCaptcha.src && !iframeCaptcha.src.includes("kcap_none")) {
            dialogCaptcha.src = iframeCaptcha.src;
          }
        }, 500);
      }
    } catch {}
    if (codeInput) codeInput.value = "";
    setTimeout(filterComments, 500);
  }, 1000);
}

/* ================================================================
   Feature: AJAX gallery list reload
   ================================================================ */

// Remember the original list page URL (before direct view changes it)
let savedListUrl = (() => {
  const href = location.href;
  if (!testURI("no", href)) return href;
  return null;
})();

/* Helper: get the base list URL (strip mode/tab params) for gallery title reload */
function getBaseListUrl() {
  const url = new URL(savedListUrl || location.href);
  url.searchParams.delete("exception_mode");
  url.searchParams.delete("search_head");
  url.searchParams.delete("page");
  url.searchParams.delete("no");
  url.searchParams.delete("t");
  return url.href;
}

/* Helper: get the current list URL respecting 개념글 mode + 말머리 tab.
   Uses savedListUrl to avoid fetching a view URL during direct view. */
function getCurrentListUrl() {
  const base = savedListUrl || location.href;
  const url = new URL(base);

  // Strip view-page params that shouldn't be in list URL
  url.searchParams.delete("no");
  url.searchParams.delete("t");

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

    closeDialog(true);

    const fl = $(".page_head > .fl");
    if (fl) fl.appendChild($.el(loadingHTML));

    // Always go back to normal (전체글) mode
    const targetHref = getBaseListUrl();
    savedListUrl = targetHref;
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
   Feature: Comment Auto Refresh (view page / direct view)
   ================================================================ */

let commentRefreshTimer = null;
const COMMENT_REFRESH_INTERVAL = 5_000;

function startCommentRefresh() {
  stopCommentRefresh();
  commentRefreshTimer = setInterval(doCommentRefresh, COMMENT_REFRESH_INTERVAL);
}

function stopCommentRefresh() {
  if (commentRefreshTimer) {
    clearInterval(commentRefreshTimer);
    commentRefreshTimer = null;
  }
}

function doCommentRefresh() {
  // Find the comment container (direct view dialog or page)
  const container = $("#dcs_dialog") || document;
  const cmtList = container.querySelector("ul.cmt_list");
  if (!cmtList) return;

  // Skip refresh if user has inline reply form open (대댓글 입력 중)
  if (cmtList.querySelector("#cmt_write_box")) return;

  // Skip refresh if user is typing in the main comment textarea
  const writeBox = container.querySelector(".cmt_write_box");
  const textarea = writeBox ? writeBox.querySelector("textarea") : null;
  if (textarea && (document.activeElement === textarea || textarea.value.trim() !== "")) return;

  // Use viewComments() via page_bridge — it calls the DC API (POST /board/comment/)
  // and replaces only .comment_box, leaving the main .cmt_write_box untouched
  // Use refreshOnly flag to skip kcaptcha re-init
  document.dispatchEvent(new CustomEvent("__dc_addon_viewComments", {
    detail: { refreshOnly: true }
  }));

  setTimeout(filterComments, 500);
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

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await $.get(url);
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

async function doAutoRefresh() {
  const gallList = $(".gall_list tbody");
  if (!gallList) return;

  const isNotice = (row) => row.dataset.type === "icon_notice";

  // Map existing posts: no → row element
  const existingMap = new Map();
  for (const row of $.all(".gall_list .ub-content.us-post")) {
    if (isNotice(row)) continue;
    const no = row.dataset.no;
    if (no) existingMap.set(no, row);
  }

  // Build fetch URL reflecting current list mode (개념글, 말머리 탭, etc.)
  const fetchUrl = getCurrentListUrl();

  try {
    const html = await fetchWithRetry(fetchUrl);
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    const fetchedRows = tpl.content.querySelectorAll(".gall_list .ub-content.us-post");

    const newRows = [];
    for (const row of fetchedRows) {
      if (isNotice(row)) continue;
      const no = row.dataset.no;
      if (!no) continue;

      if (!existingMap.has(no)) {
        // New post
        newRows.push(row);
      } else {
        // Existing post — check for comment count change
        const existingRow = existingMap.get(no);
        const oldReply = existingRow.querySelector(".reply_num");
        const newReply = row.querySelector(".reply_num");
        const oldText = oldReply ? oldReply.textContent : "";
        const newText = newReply ? newReply.textContent : "";
        if (oldText !== newText && newText) {
          if (oldReply) {
            // Update existing reply count
            oldReply.textContent = newText;
          } else {
            // No reply_num existed — insert the new one from fetched row
            const oldTit = existingRow.querySelector(".gall_tit");
            const newTit = row.querySelector(".gall_tit");
            if (oldTit && newTit) {
              oldTit.innerHTML = newTit.innerHTML;
            }
          }
          // Highlight comment count change (light blue)
          const highlight = existingRow.querySelector(".reply_num");
          if (highlight) {
            highlight.style.backgroundColor = "rgba(59, 130, 246, 0.15)";
            highlight.style.borderRadius = "4px";
            highlight.style.transition = "background-color 5s ease";
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                highlight.style.backgroundColor = "";
              });
            });
          }
        }
      }
    }

    // Insert new rows
    if (newRows.length > 0) {
      let insertBefore = null;
      for (const row of gallList.querySelectorAll(".ub-content.us-post")) {
        if (!isNotice(row)) {
          insertBefore = row;
          break;
        }
      }
      if (insertBefore) {
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
      }
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

    // Start comment auto-refresh on view pages
    if (testURI("no", href)) {
      startCommentRefresh();
    }
  });

  filterPosts();

  const href = document.location.href;
  if (!testURI("s_type", href) && !testURI("no", href)) {
    initGallReload();
  }
})();
