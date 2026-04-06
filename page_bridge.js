/**
 * Runs in the MAIN world (page context).
 * Loads comment.js if needed, sets jQuery data, then calls viewComments.
 * Also handles comment submission using page-context tokens.
 */
document.addEventListener("__dc_addon_viewComments", (e) => {
  const detail = e.detail || {};

  // Set jQuery data for viewComments to read
  if (typeof $ === "function" && $(document).data) {
    if (detail.gallery_id) {
      $(document).data("gallery_id", detail.gallery_id);
      $(document).data("comment_id", detail.gallery_id);
    }
    if (detail.no) {
      $(document).data("article_no", detail.no);
      $(document).data("comment_no", detail.no);
      if ($("#no").length) {
        $("#no").val(detail.no);
      } else {
        const inp = document.createElement("input");
        inp.type = "hidden";
        inp.id = "no";
        inp.value = detail.no;
        document.body.appendChild(inp);
      }
    }
  }

  function callViewComments() {
    if (typeof viewComments === "function") {
      viewComments(1, "VIEW_PAGE");
    }
  }

  // If viewComments doesn't exist, load comment.js first
  if (typeof viewComments !== "function") {
    const script = document.createElement("script");
    script.src = "https://gall.dcinside.com/_js/comment.js";
    script.onload = callViewComments;
    document.head.appendChild(script);
  } else {
    callViewComments();
  }
});

/**
 * Comment submit via MAIN world.
 * MV3 CSP blocks inline scripts inside iframes, so iframe's comment.js
 * tokens (document.service_code, t_vch2, etc.) are never set.
 * Instead, we read them from the parent page context and POST directly.
 */
document.addEventListener("__dc_addon_commentSubmit", (e) => {
  const d = e.detail || {};
  const gall_id = d.id;
  const no = d.no;

  // Build formData mirroring comment.js logic (lines 1373-1570)
  var formData = "id=" + gall_id + "&no=" + no;
  if (d.c_no) formData += "&c_no=" + d.c_no;
  formData += "&reply_no=" + (d.reply_no || "");

  if (d.name) formData += "&name=" + d.name;
  if (d.password) formData += "&password=" + encodeURIComponent(d.password);
  if (d.code) formData += "&code=" + d.code;
  formData += "&memo=" + encodeURIComponent(d.memo || "");

  // Tokens from page context — these are only available in MAIN world
  var t_vch2 = "", t_vch2_chk = "";
  if (typeof $ === "function" && $(document).data) {
    t_vch2 = $(document).data("t_vch2") || "";
    t_vch2_chk = $(document).data("t_vch2_chk") || "";
  }

  var e_s_n_o = "";
  var el = document.getElementById("e_s_n_o");
  if (el) e_s_n_o = el.value;

  var cur_t = "";
  el = document.getElementById("cur_t");
  if (el) cur_t = el.value;

  var recommend = "";
  el = document.getElementById("recommend");
  if (el) recommend = el.value;

  var _GALLTYPE_ = "";
  el = document.getElementById("_GALLTYPE_");
  if (el) _GALLTYPE_ = el.value;

  var c_r_k_x_z = "";
  el = document.getElementById("c_r_k_x_z");
  if (el) c_r_k_x_z = el.value;

  var csrf_token = "";
  var ciEl = document.querySelector("input[name=ci_t]");
  if (ciEl) csrf_token = ciEl.value;
  if (!csrf_token) {
    var ciM = document.cookie.match(/ci_c=([^;]*)/);
    if (ciM) csrf_token = ciM[1];
  }

  // Decode service_code: run the same _d() + rc1() chain that the view page runs.
  // On list pages document.service_code doesn't exist, so we decode it from
  // the _d() argument extracted from the view page HTML.
  // Derive document.service_code the same way DC's obfuscated code does:
  //   1. raw = <input name="service_code"> value (from HTML)
  //   2. _r = _d(arg) → comma-separated numbers
  //   3. rc1() flips first digit of _r
  //   4. decode _r numbers → 10-char suffix
  //   5. service_code = raw with last 10 chars replaced by suffix
  var service_code = document.service_code || "";
  if (!service_code && d.service_code && d.d_arg) {
    try {
      // _d() — DC's custom Base64 decoder
      var _dc_d = function(r) {
        var a,e,n,t,f,dd,h,
        i="yL/M=zNa0bcPQdReSfTgUhViWjXkYIZmnpo+qArOBslCt2D3uE4Fv5G6wH178xJ9K",
        o="",c=0;
        for(r=r.replace(/[^A-Za-z0-9+\/=]/g,"");c<r.length;)
          t=i.indexOf(r.charAt(c++)),f=i.indexOf(r.charAt(c++)),
          dd=i.indexOf(r.charAt(c++)),h=i.indexOf(r.charAt(c++)),
          a=t<<2|f>>4,e=(15&f)<<4|dd>>2,n=(3&dd)<<6|h,
          o+=String.fromCharCode(a),64!=dd&&(o+=String.fromCharCode(e)),64!=h&&(o+=String.fromCharCode(n));
        return o;
      };
      var raw = d.service_code;            // <input name="service_code"> value
      var _r_str = _dc_d(d.d_arg).replace(/[\x00\s]/g, ""); // clean null/whitespace
      // rc1() logic: flip first digit
      var fi = parseInt(_r_str.charAt(0));
      fi = fi > 5 ? fi - 5 : fi + 4;
      _r_str = fi + _r_str.substring(1);
      // Decode number array to suffix string
      var _rs = _r_str.split(",").filter(function(s) { return s !== ""; });
      var suffix = "";
      for (var idx = 0; idx < _rs.length; idx++) {
        suffix += String.fromCharCode(Math.round(2 * (parseInt(_rs[idx]) - idx - 1) / (13 - idx - 1)));
      }
      // Replace last 10 chars of raw service_code with decoded suffix
      service_code = raw.replace(/(.{10})$/, suffix);
    } catch (e) {
      // Fallback to cookie
      var m = document.cookie.match(/service_code=([^;]*)/);
      if (m) service_code = m[1];
    }
  }

  // t_vch2: prefer page-context jQuery data, fall back to HTML-extracted value
  if (!t_vch2 && d.t_vch2 !== undefined) t_vch2 = d.t_vch2;
  if (!t_vch2_chk && d.t_vch2_chk !== undefined) t_vch2_chk = d.t_vch2_chk;

  formData += "&cur_t=" + cur_t;
  formData += "&check_6=" + (d.check_6 || "");
  formData += "&check_7=" + (d.check_7 || "");
  formData += "&check_8=" + (d.check_8 || "");
  formData += "&check_9=" + (d.check_9 || "");
  formData += "&check_10=" + (d.check_10 || "");
  formData += "&recommend=" + recommend;
  formData += "&c_r_k_x_z=" + c_r_k_x_z;
  formData += "&t_vch2=" + t_vch2 + "&t_vch2_chk=" + t_vch2_chk;
  formData += "&c_gall_id=" + gall_id + "&c_gall_no=" + no;
  formData += "&service_code=" + service_code;
  formData += "&g-recaptcha-response=";
  formData += "&_GALLTYPE_=" + _GALLTYPE_;
  formData += "&headTail=";

  if (d.use_gall_nick) {
    formData += "&gall_nick_name=" + (d.gall_nick_name || "") + "&use_gall_nick=" + d.use_gall_nick;
  }

  formData += "&ci_t=" + csrf_token;

  $.ajax({
    type: "POST",
    cache: false,
    async: false,
    url: "/board/forms/comment_submit",
    data: formData,
    success: function (data) {
      var split = data.split("||");
      var result = { success: split[0].trim() !== "false", message: data };
      document.dispatchEvent(new CustomEvent("__dc_addon_commentResult", {
        detail: result
      }));
      // Refresh comments
      if (typeof viewComments === "function") {
        viewComments(1, "");
      }
    },
    error: function () {
      document.dispatchEvent(new CustomEvent("__dc_addon_commentResult", {
        detail: { success: false, message: "AJAX error" }
      }));
    }
  });
});
