/**
 * Lightweight DOM utility library
 * Replaces fxjs + fxjs-dom used in v2
 */

const $ = (sel) => document.querySelector(sel);
$.all = (sel) => [...document.querySelectorAll(sel)];

$.el = (html) => {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstChild;
};

$.els = (html) => {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return [...tpl.content.childNodes];
};

// Tree traversal
$.find = (sel, el) => el.querySelector(sel);
$.findAll = (sel, el) => [...el.querySelectorAll(sel)];
$.closest = (sel, el) => el.closest(sel);
$.children = (el) => [...el.children];

// Manipulation
$.append = (parent, child) => (parent.appendChild(child), child);
$.prepend = (parent, child) => (parent.insertBefore(child, parent.firstChild), child);
$.before = (ref, node) => (ref.parentNode.insertBefore(node, ref), node);
$.after = (ref, node) => {
  ref.nextSibling
    ? ref.parentNode.insertBefore(node, ref.nextSibling)
    : ref.parentNode.appendChild(node);
  return node;
};
$.remove = (el) => {
  if (el && el.parentNode) el.parentNode.removeChild(el);
  return el;
};

// Attributes & properties
$.attr = (key, el) => el.getAttribute(key);
$.setAttr = (key, val, el) => (el.setAttribute(key, val), el);
$.val = (el) => el.value;
$.setVal = (val, el) => (el.value = val, el);
$.text = (el) => el.textContent;
$.html = (el) => el.innerHTML;
$.setHtml = (html, el) => (el.innerHTML = html, el);

// Classes
$.addClass = (cls, el) => (el.classList.add(...cls.split(" ")), el);
$.removeClass = (cls, el) => (el.classList.remove(...cls.split(" ")), el);
$.toggleClass = (cls, el) => (el.classList.toggle(cls), el);

// Styles
$.css = (key, el) =>
  el.style[key] || el.ownerDocument.defaultView.getComputedStyle(el, null)[key];

$.setCss = (styles, el) => {
  if (Array.isArray(styles)) {
    el.style[styles[0]] = styles[1];
  } else {
    for (const [k, v] of Object.entries(styles)) el.style[k] = v;
  }
  return el;
};

$.show = (el) => (el.style.display = "", el);
$.hide = (el) => (el.style.display = "none", el);

// Events
$.on = (event, handler, el) => (el.addEventListener(event, handler), el);
$.off = (event, handler, el) => (el.removeEventListener(event, handler), el);

$.delegate = (el, event, sel, handler) => {
  el.addEventListener(event, (e) => {
    const target = e.target.closest(sel);
    if (target && el.contains(target)) {
      handler(e, target);
    }
  });
  return el;
};

// Scroll & offset
$.offset = (el) => {
  const rect = el.getBoundingClientRect();
  return {
    top: rect.top + window.pageYOffset,
    left: rect.left + window.pageXOffset,
  };
};

$.scrollTo = (top) => window.scrollTo({ top, behavior: "smooth" });

// Fetch helpers
$.get = (url) =>
  fetch(url, {
    headers: { Accept: "text/html" },
    credentials: "same-origin",
  }).then((r) => (r.ok ? r.text() : Promise.reject(r)));

// Animation (simple CSS transition-based replacement for anime.js)
$.animate = (props, el, duration = 500) =>
  new Promise((resolve) => {
    const keys = Object.keys(props);
    el.style.transition = keys.map((k) => `${k} ${duration}ms ease-in-out`).join(", ");

    // Force reflow before applying new values
    void el.offsetHeight;

    for (const [k, v] of Object.entries(props)) {
      el.style[k] = typeof v === "number" ? `${v}px` : v;
    }

    const onEnd = () => {
      el.removeEventListener("transitionend", onEnd);
      el.style.transition = "";
      resolve(el);
    };
    el.addEventListener("transitionend", onEnd);

    // Fallback in case transitionend doesn't fire
    setTimeout(() => resolve(el), duration + 50);
  });

// $ is available as a global in content scripts
