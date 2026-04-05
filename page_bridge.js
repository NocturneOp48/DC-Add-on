/**
 * Runs in the MAIN world (page context).
 * Loads comment.js if needed, sets jQuery data, then calls viewComments.
 * Also initializes kcaptcha for non-logged-in captcha in direct view.
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
