// The hanging badge is lovely, and it is also React + three.js + a physics
// engine: well over 2 MB of JavaScript, which used to be parsed before the
// home page could show anything at all. Nothing above the fold needs it, so
// it is loaded as its own chunk once the page has painted and the browser has
// a spare moment. The badge simply appears a beat later than the text.
function loadLanyard() {
  import("./Lanyard.jsx");
}

if (document.readyState === "complete") {
  (window.requestIdleCallback || ((fn) => setTimeout(fn, 200)))(loadLanyard);
} else {
  window.addEventListener("load", () => {
    (window.requestIdleCallback || ((fn) => setTimeout(fn, 200)))(loadLanyard);
  });
}
