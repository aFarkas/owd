/* =========================================================================
   progress.js — Fortschritts-Tracking & Feedback-Schleife für den OWD-Kurs
   -------------------------------------------------------------------------
   WAS ES TUT
   1) Speichert jedes Quiz-Ergebnis (pro Lektion, pro Frage: gewählt/richtig)
      dauerhaft im localStorage des Browsers.
   2) Fügt am Ende jeder Lektion automatisch eine Feedback-Box ein. Fine
      schreibt dort ihr Feedback; per Klick öffnet sich eine vorbereitete
      E-Mail an Alexander (FEEDBACK_TO) — inklusive der Quiz-Ergebnisse dieser
      Lektion in einem Format, das Claude im Chat direkt auswerten kann.
   3) Rendert auf der Startseite (#owd-progress) einen Fortschritts-Überblick
      samt Button "Gesamtfortschritt senden".

   WICHTIG (Grenzen der Technik):
   - Statische HTML-Dateien können sich NICHT selbst beschreiben. Der Verlauf
     lebt im localStorage (nur in DIESEM Browser) und reist über die E-Mail.
   - localStorage kann vom Nutzer/Browser gelöscht werden. Die E-Mail ist die
     verlässliche Brücke zu Alexander/Claude — deshalb wandern die Ergebnisse
     dort immer mit.
   ========================================================================= */

(function () {
  "use strict";

  var FEEDBACK_TO = "a.farkas.pm@gmail.com";   // Alexander (Projekt-Einrichter)
  var STORE_KEY = "owd-ssi-progress-v1";

  /* ------------------------------ Speicher ------------------------------ */
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || { lessons: {} }; }
    catch (e) { return { lessons: {} }; }
  }
  function save(data) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); return true; }
    catch (e) { return false; }
  }

  function lessonId() {
    var m = (location.pathname.split("/").pop() || "lektion").replace(/\.html?$/i, "");
    return m || "lektion";
  }
  function lessonTitle() {
    var h = document.querySelector("h1");
    if (h) return h.textContent.trim();
    return (document.title || lessonId()).replace(/\s*·.*$/, "").trim();
  }
  function nowStamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* --------------------------- Öffentliche API -------------------------- */
  window.OWD = {
    recordQuiz: function (payload) {
      var data = load();
      var id = lessonId();
      var entry = data.lessons[id] || {};
      entry.title = lessonTitle();
      entry.lastQuiz = payload;              // letztes Ergebnis
      entry.attempts = (entry.attempts || 0) + 1;
      entry.best = Math.max(entry.best || 0, payload.pct || 0);
      entry.ts = nowStamp();
      data.lessons[id] = entry;
      save(data);
      renderFeedbackSummary();               // Box aktualisieren, falls vorhanden
    },
    getData: load,
    lessonId: lessonId,
    lessonTitle: lessonTitle
  };

  /* --------------------- Feedback-Text für die E-Mail ------------------- */
  function quizReport(entry) {
    if (!entry || !entry.lastQuiz) return "Quiz: noch nicht bearbeitet.";
    var q = entry.lastQuiz;
    var lines = [];
    lines.push("Quiz-Ergebnis: " + q.correct + "/" + q.total + " (" + q.pct + "%) · Modus: " + q.mode);
    var falsch = (q.questions || []).filter(function (x) { return !x.correct; });
    if (falsch.length === 0) {
      lines.push("Alle Fragen richtig.");
    } else {
      lines.push("Falsch beantwortet:");
      falsch.forEach(function (x) {
        var chosen = (x.chosen == null) ? "—" : String.fromCharCode(65 + x.chosen);
        var right = String.fromCharCode(65 + x.answer);
        lines.push("  - Frage " + x.n + " (gewählt " + chosen + ", richtig " + right + "): " +
          (x.prompt || "").slice(0, 90));
      });
    }
    return lines.join("\n");
  }

  function buildBody(entry, feedbackText) {
    return [
      "=== OWD-SSI FEEDBACK ===",
      "Lektion: " + lessonId() + " — " + lessonTitle(),
      "Datum: " + nowStamp(),
      "",
      quizReport(entry),
      "",
      "--- Fines Feedback ---",
      (feedbackText || "").trim() || "(kein Text eingegeben)",
      "",
      "=== ENDE (bitte komplett in den Claude-Chat kopieren) ==="
    ].join("\n");
  }

  function mailto(subject, body) {
    return "mailto:" + FEEDBACK_TO +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);
  }

  /* ---------------------- Feedback-Box (pro Lektion) -------------------- */
  var elFeedbackSummary = null;

  function renderFeedbackSummary() {
    if (!elFeedbackSummary) return;
    var entry = load().lessons[lessonId()];
    elFeedbackSummary.textContent = entry && entry.lastQuiz
      ? "Dein letztes Quiz-Ergebnis (" + entry.lastQuiz.pct + " %) wird automatisch mitgeschickt."
      : "Noch kein Quiz bearbeitet — du kannst trotzdem Feedback schreiben.";
  }

  function injectFeedbackBox() {
    var wrap = document.querySelector(".wrap");
    if (!wrap || !document.querySelector(".quiz")) return;   // nur auf Lektionsseiten

    var sec = document.createElement("section");
    sec.className = "feedback-block";
    sec.innerHTML =
      '<h2>💬 Feedback zu dieser Lektion</h2>' +
      '<p class="small">War etwas unklar, zu leicht, zu schwer? Fehlt ein Beispiel? ' +
      'Schreib es hier auf. Mit einem Klick öffnet sich eine fertige E-Mail an Alexander — ' +
      'er kopiert sie in den Chat, dann bessere ich die Lektion nach. ' +
      '<a href="feedback-hilfe.html">So funktioniert die Feedback-Schleife →</a></p>' +
      '<textarea class="feedback-text" rows="5" ' +
      'placeholder="Dein Feedback zu dieser Lektion … (z. B. Frage 2 war missverständlich, oder: Boyle bitte mit mehr Beispielen)"></textarea>' +
      '<div class="feedback-summary small"></div>' +
      '<div class="feedback-actions">' +
      '<button type="button" class="fb-send">✉️ Feedback an Alexander senden</button>' +
      '<button type="button" class="fb-copy">Text + Ergebnis kopieren</button>' +
      '</div>' +
      '<div class="fb-status small" role="status"></div>';
    wrap.appendChild(sec);

    var ta = sec.querySelector(".feedback-text");
    elFeedbackSummary = sec.querySelector(".feedback-summary");
    var status = sec.querySelector(".fb-status");
    renderFeedbackSummary();

    // Entwurf zwischenspeichern
    var draftKey = "owd-fb-draft-" + lessonId();
    try { ta.value = localStorage.getItem(draftKey) || ""; } catch (e) {}
    ta.addEventListener("input", function () {
      try { localStorage.setItem(draftKey, ta.value); } catch (e) {}
    });

    sec.querySelector(".fb-send").addEventListener("click", function () {
      var entry = load().lessons[lessonId()];
      var body = buildBody(entry, ta.value);
      var subject = "OWD-Feedback · " + lessonId() + " · " + lessonTitle();
      window.location.href = mailto(subject, body);
      status.textContent = "E-Mail-Programm geöffnet. Falls nichts passiert: nutz „Text + Ergebnis kopieren“ und mail es an " + FEEDBACK_TO + ".";
    });

    sec.querySelector(".fb-copy").addEventListener("click", function () {
      var entry = load().lessons[lessonId()];
      var text = buildBody(entry, ta.value);
      copyText(text, status);
    });
  }

  /* ------------------------ Startseiten-Dashboard ---------------------- */
  // Reihenfolge = SSI-Kapitelstruktur. 0006 (Kap 5 · Das Meer) und 0008
  // (Anhang · Tauchtabellen) sind jetzt vorhanden und Teil der Fortschrittszählung.
  var LESSON_ORDER = [
    "0001-willkommen", "0002-druck-und-koerper", "0003-ausruestung",
    "0004-atemgas-stickstoff-nullzeit", "0005-buddy-signale-planung", "0006-das-meer",
    "0007-notfaelle", "0008-tauchtabellen",
    "0009-tipps-vor-dem-pool", "0010-tipps-vor-dem-freiwasser", "0011-abschlusstest"
  ];

  function badgeHTML(pct) {
    return pct == null
      ? '<span class="pg-none">offen</span>'
      : '<span class="pg-pct ' + (pct >= 80 ? "ok" : "low") + '">' + pct + ' %</span>';
  }

  // Fortschritts-Badge direkt in die echten Lektionslisten (index.html) einblenden,
  // gematcht über den Dateinamen im href. So gibt es keine doppelte Liste mehr.
  function injectLessonBadges(data) {
    var links = document.querySelectorAll(".lesson-list a[href]");
    Array.prototype.forEach.call(links, function (a) {
      if (a.querySelector(".lesson-badge")) return;              // nicht doppelt
      var file = (a.getAttribute("href") || "").split("/").pop().replace(/\.html?$/i, "");
      if (!file) return;
      var e = data.lessons[file];
      var pct = e && e.lastQuiz ? e.lastQuiz.pct : null;
      var span = document.createElement("span");
      span.className = "lesson-badge";
      span.innerHTML = badgeHTML(pct);
      a.appendChild(span);
    });
  }

  function renderDashboard() {
    var data = load();

    // 1) Badges in die Lektionslisten unten schreiben (falls vorhanden).
    injectLessonBadges(data);

    // 2) #owd-progress zeigt nur noch Zusammenfassung + Senden-Button.
    var mount = document.getElementById("owd-progress");
    if (!mount) return;
    var done = 0, sum = 0, cnt = 0;
    LESSON_ORDER.forEach(function (id) {
      var e = data.lessons[id];
      var pct = e && e.lastQuiz ? e.lastQuiz.pct : null;
      if (pct != null) { done++; sum += pct; cnt++; }
    });

    var avg = cnt ? Math.round(sum / cnt) : 0;
    mount.innerHTML =
      '<div class="pg-head">' +
        '<div><strong>' + done + '</strong> / ' + LESSON_ORDER.length + ' Lektionen mit Quiz' +
        (cnt ? ' · Ø ' + avg + ' %' : '') + ' · dein Stand steht bei jeder Lektion unten.</div>' +
        '<button type="button" class="fb-send-all">✉️ Gesamtfortschritt an Alexander senden</button>' +
      '</div>' +
      '<div class="fb-status small" role="status"></div>';

    mount.querySelector(".fb-send-all").addEventListener("click", function () {
      var body = buildFullReport(data);
      var subject = "OWD-Fortschritt · Gesamtübersicht";
      window.location.href = mailto(subject, body);
      mount.querySelector(".fb-status").textContent =
        "E-Mail geöffnet. Falls nichts passiert, den Verlauf bitte manuell an " + FEEDBACK_TO + " mailen.";
    });
  }

  function buildFullReport(data) {
    var out = ["=== OWD-SSI GESAMTFORTSCHRITT ===", "Datum: " + nowStamp(), ""];
    LESSON_ORDER.forEach(function (id, i) {
      var e = data.lessons[id];
      if (!e || !e.lastQuiz) { out.push((i + 1) + ". " + id + ": offen"); return; }
      out.push((i + 1) + ". " + e.title + " — " + e.lastQuiz.correct + "/" + e.lastQuiz.total +
        " (" + e.lastQuiz.pct + "%), Versuche: " + e.attempts + ", best: " + e.best + "%");
      var falsch = (e.lastQuiz.questions || []).filter(function (x) { return !x.correct; });
      falsch.forEach(function (x) {
        out.push("     ✗ Frage " + x.n + ": " + (x.prompt || "").slice(0, 80));
      });
    });
    out.push("", "=== ENDE (komplett in den Claude-Chat kopieren) ===");
    return out.join("\n");
  }

  /* ------------------------------ Helfer -------------------------------- */
  function copyText(text, status) {
    function ok() { if (status) status.textContent = "In die Zwischenablage kopiert – jetzt in eine E-Mail an " + FEEDBACK_TO + " einfügen."; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { legacyCopy(text, ok); });
    } else { legacyCopy(text, ok); }
  }
  function legacyCopy(text, cb) {
    var t = document.createElement("textarea");
    t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(t); if (cb) cb();
  }

  document.addEventListener("DOMContentLoaded", function () {
    injectFeedbackBox();
    renderDashboard();
  });
})();
