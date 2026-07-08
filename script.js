/* ============================================================
   Neumeric — shared interactions
   ============================================================ */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* footer year */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  /* mobile nav */
  var nav = document.getElementById("nav");
  var burger = document.getElementById("burger");
  if (nav && burger) {
    burger.addEventListener("click", function () { nav.classList.toggle("open"); });
    nav.querySelectorAll(".nav-links a").forEach(function (a) {
      a.addEventListener("click", function () { nav.classList.remove("open"); });
    });
  }

  /* reveal on scroll */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  }

  /* scrollytelling (home only) */
  var scrolly = document.getElementById("scrolly");
  var viz = document.getElementById("viz");
  var steps = [].slice.call(document.querySelectorAll(".step"));
  var segs = [].slice.call(document.querySelectorAll(".scrolly-progress i"));
  var lastStep = -1;
  function setStage(n) {
    if (viz) viz.className = "viz stage-" + (n + 1);
    steps.forEach(function (s, i) { s.classList.toggle("active", i === n); });
  }
  function onScroll() {
    if (!scrolly) return;
    var rect = scrolly.getBoundingClientRect();
    var total = scrolly.offsetHeight - window.innerHeight;
    var scrolled = Math.min(Math.max(-rect.top, 0), total);
    var p = total > 0 ? scrolled / total : 0;
    var idx = Math.min(steps.length - 1, Math.floor(p * steps.length));
    if (idx !== lastStep) { setStage(idx); lastStep = idx; }
    segs.forEach(function (seg, i) {
      var segP = (p - i / steps.length) * steps.length;
      seg.style.width = Math.max(0, Math.min(1, segP)) * 100 + "%";
    });
  }
  if (scrolly && steps.length) {
    setStage(0);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
  }

  /* early-access form (contact) */
  var form = document.getElementById("ea-form");
  var success = document.getElementById("ea-success");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = form.querySelector("#f-name");
      var email = form.querySelector("#f-email");
      var ok = true;
      [name, email].forEach(function (f) {
        if (!f.value.trim()) { f.style.borderColor = "#c0392b"; ok = false; }
        else { f.style.borderColor = ""; }
      });
      if (email.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) { email.style.borderColor = "#c0392b"; ok = false; }
      if (!ok) return;

      // map operation type → distribution channel (funnel analytics)
      var type = ((form.querySelector("#f-type") || {}).value || "").toLowerCase();
      var channel = "direct";
      if (type.indexOf("lender") !== -1 || type.indexOf("co-op") !== -1) channel = "lender";
      else if (type.indexOf("agent") !== -1) channel = "agent";

      var btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.style.opacity = "0.6"; }

      fetch("https://neumeric-platform.vercel.app/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.value.trim(),
          name: name.value.trim(),
          acres: (form.querySelector("#f-acres") || {}).value || "",
          channel: channel
        })
      })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (data) {
          if (data && data.error) {
            if (btn) { btn.disabled = false; btn.style.opacity = ""; }
            email.style.borderColor = "#c0392b";
            alert(data.error);
            return;
          }
          form.querySelector(".form-grid").style.display = "none";
          form.querySelector(".form-foot").style.display = "none";
          if (success) {
            success.textContent =
              "Almost there — check your email and click the confirmation link to lock in your spot.";
            success.classList.add("show");
          }
        })
        .catch(function () {
          if (btn) { btn.disabled = false; btn.style.opacity = ""; }
          alert("Couldn't reach the server — check your connection and try again.");
        });
    });
  }
})();
