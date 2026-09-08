/* =========================================================================
   quiz.js — wiederverwendbare Lern-Komponenten für den OWD-SSI-Kurs
   Enthält:
     1) .quiz         Multiple-Choice mit zwei Modi:
                        - Übung (Standard): sofortiges Feedback pro Frage
                        - Prüfung  (data-mode="exam"): erst alles beantworten,
                          dann "Auswerten" → Score gegen Bestehensgrenze
     2) .recall       Aktiv-Erinnern-Karte (Frage → klick → Antwort)

   Ergebnisse werden – falls progress.js geladen ist – über
   window.OWD.recordQuiz(...) dauerhaft im localStorage gespeichert und
   fließen in Fines Feedback-E-Mail ein.

   Markup .quiz:
     <div class="quiz" data-mode="exam" data-pass="80">
       <div class="quiz-q" data-answer="1">
         <p class="quiz-prompt">Frage?</p>
         <div class="quiz-options">
           <button class="quiz-opt">A</button>
           <button class="quiz-opt">B</button>   <!-- richtig (Index 1) -->
         </div>
         <div class="quiz-explain">Erklärung …</div>
       </div>
       …
     </div>

   Markup .recall:
     <div class="recall"><div class="r-q">Frage?</div><div class="r-a">Antwort.</div></div>
   ========================================================================= */

(function () {
  "use strict";

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  /* ------------------- Adaptive Frage-Auswahl (Score) -------------------
     Pro Frage merken wir uns im localStorage einen Score:
       +1 pro richtiger, -1 pro falscher Antwort, geklemmt auf -3 … +3.
       Start = 0.  Score = +3  → "gemeistert", wird nicht mehr gestellt.
                   Score = -3  → wird sehr wahrscheinlich gestellt.
     Gespeichert je Lektion (lessonId) unter einer stabilen Frage-ID, die
     aus dem Fragetext gehasht wird (überlebt Umsortieren der Fragen).      */
  var SCORE_KEY = "owd-ssi-qscore-v1";
  var SCORE_MIN = -3, SCORE_MAX = 3, MASTERED = 3;

  function scoreLessonId() {
    var m = (location.pathname.split("/").pop() || "quiz").replace(/\.html?$/i, "");
    return m || "quiz";
  }
  function loadScores() {
    try { return JSON.parse(localStorage.getItem(SCORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveScores(all) {
    try { localStorage.setItem(SCORE_KEY, JSON.stringify(all)); } catch (e) {}
  }
  function clampScore(n) {
    return Math.max(SCORE_MIN, Math.min(SCORE_MAX, n));
  }
  // stabile ID aus dem Fragetext (djb2)
  function qid(text) {
    var h = 5381, i = text.length;
    while (i) { h = (h * 33) ^ text.charCodeAt(--i); }
    return "q" + (h >>> 0).toString(36);
  }
  // Auswahl-Gewicht: niedriger Score → deutlich häufiger.
  function weightFor(score) { return Math.pow(2, -score); }   // -3→8, 0→1, +2→0.25

  // Gewichtete Ziehung ohne Zurücklegen von n Elementen aus pool ([{item,w}]).
  function weightedSample(pool, n) {
    var items = pool.slice(), picked = [];
    for (var k = 0; k < n && items.length; k++) {
      var totalW = 0, j;
      for (j = 0; j < items.length; j++) totalW += items[j].w;
      var r = Math.random() * totalW, acc = 0, idx = 0;
      for (j = 0; j < items.length; j++) {
        acc += items[j].w;
        if (r <= acc) { idx = j; break; }
        idx = j;
      }
      picked.push(items[idx].item);
      items.splice(idx, 1);
    }
    return picked;
  }

  function record(quiz, questions, correct, total, isExam) {
    if (!window.OWD || typeof window.OWD.recordQuiz !== "function") return;
    var details = questions.map(function (q, i) {
      var ai = parseInt(q.getAttribute("data-answer"), 10);
      return {
        n: i + 1,
        prompt: q._prompt || "",
        chosen: q.chosen,
        answer: ai,
        correct: q.chosen === ai
      };
    });
    try {
      window.OWD.recordQuiz({
        mode: isExam ? "exam" : "practice",
        correct: correct,
        total: total,
        pct: total ? Math.round((correct / total) * 100) : 0,
        questions: details
      });
    } catch (e) { /* Tracking ist optional – nie den Kurs blockieren */ }
  }

  /* -------------------------------- QUIZ -------------------------------- */
  function initQuiz(quiz) {
    var mode = quiz.getAttribute("data-mode");
    var isAdaptive = mode === "adaptive";
    var isExam = mode === "exam" || isAdaptive;   // beide: erst alles, dann auswerten
    var pass = parseInt(quiz.getAttribute("data-pass") || "80", 10);
    var allQuestions = Array.prototype.slice.call(quiz.querySelectorAll(".quiz-q"));

    // Jede Frage bekommt eine stabile ID aus ihrem Fragetext.
    allQuestions.forEach(function (q) {
      var p = q.querySelector(".quiz-prompt");
      q._qid = qid(p ? p.textContent.trim() : (q.getAttribute("data-answer") || ""));
    });

    // Im adaptiven Modus nur eine Teilmenge (data-ask, Standard 15) stellen –
    // gewichtet nach dem gemerkten Score. Der Rest wird ausgeblendet.
    var scores = loadScores();
    var lessonScores = scores[scoreLessonId()] || (scores[scoreLessonId()] = {});
    var questions = allQuestions;

    if (isAdaptive) {
      var askCount = parseInt(quiz.getAttribute("data-ask") || "15", 10);
      var pool = allQuestions.map(function (q) {
        var s = clampScore(lessonScores[q._qid] || 0);
        return { item: q, score: s, w: weightFor(s) };
      });
      var open = pool.filter(function (p) { return p.score < MASTERED; });
      var done = pool.filter(function (p) { return p.score >= MASTERED; });

      var chosen = weightedSample(open, askCount);
      // Nicht genug offene Fragen? Mit (gemeisterten) Wiederholungsfragen auffüllen.
      if (chosen.length < askCount && done.length) {
        chosen = chosen.concat(weightedSample(
          done.map(function (p) { return { item: p.item, w: 1 }; }),
          askCount - chosen.length));
      }

      // Auswahl in DOM-Reihenfolge halten (stabile Nummerierung).
      var pick = {};
      chosen.forEach(function (q) { pick[q._qid] = true; });
      questions = allQuestions.filter(function (q) { return pick[q._qid]; });

      // Nicht gewählte Fragen ausblenden.
      allQuestions.forEach(function (q) {
        if (!pick[q._qid]) q.style.display = "none";
      });

      renderAdaptiveIntro(quiz, pool, questions.length, allQuestions.length);
    }

    var answered = 0;
    var correct = 0;
    var total = questions.length;

    var bar = el("div", "quiz-bar");
    var status = el("span", "quiz-status");
    bar.appendChild(status);
    quiz.insertBefore(bar, quiz.firstChild);

    var result = el("div", "quiz-result");
    result.setAttribute("hidden", "");
    quiz.appendChild(result);

    function updateStatus() {
      if (isExam) {
        status.textContent = "Beantwortet: " + answered + " / " + total;
      } else {
        status.textContent = "Punkte: " + correct + " / " + answered +
          "  ·  offen: " + (total - answered);
      }
    }
    updateStatus();

    questions.forEach(function (q, qi) {
      var ai = parseInt(q.getAttribute("data-answer"), 10);
      var opts = Array.prototype.slice.call(q.querySelectorAll(".quiz-opt"));
      var explain = q.querySelector(".quiz-explain");
      var prompt = q.querySelector(".quiz-prompt");
      q._prompt = prompt ? prompt.textContent.trim() : "";   // vor dem Einfügen der Nummer merken
      var num = el("span", "quiz-num", "Frage " + (qi + 1));
      if (prompt) prompt.insertBefore(num, prompt.firstChild);
      q.chosen = null;

      opts.forEach(function (opt, oi) {
        opt.type = "button";
        opt.addEventListener("click", function () {
          if (isExam) {
            if (q.chosen === null) answered++;
            q.chosen = oi;
            opts.forEach(function (o) { o.classList.remove("chosen"); });
            opt.classList.add("chosen");
            updateStatus();
          } else {
            if (q.locked) return;
            q.locked = true;
            q.chosen = oi;
            answered++;
            var right = oi === ai;
            if (right) correct++;
            opts.forEach(function (o, k) {
              o.disabled = true;
              if (k === ai) o.classList.add("correct");
              if (k === oi && !right) o.classList.add("incorrect");
            });
            if (explain) explain.classList.add("show");
            updateStatus();
            if (answered === total) showResult();
          }
        });
      });
    });

    function showResult() {
      var pct = total ? Math.round((correct / total) * 100) : 0;
      result.innerHTML = "";
      var passed = pct >= pass;
      result.classList.toggle("pass", passed);
      result.classList.toggle("fail", !passed);
      result.appendChild(el("div", "quiz-score", pct + " %"));
      result.appendChild(el("div", "quiz-sub",
        correct + " von " + total + " richtig · Bestehensgrenze " + pass + " %"));
      var msg = el("p", "quiz-msg");
      if (isExam) {
        var tail = isAdaptive
          ? " Klick „Nochmal versuchen“ für den nächsten Durchgang — schwache Fragen kommen dann gezielt wieder."
          : "";
        msg.textContent = passed
          ? "Bestanden — und zwar souverän. Geh die falsch beantworteten Fragen unten noch einmal durch, dann sitzt es." + tail
          : "Noch nicht ganz. Schau dir die markierten Fragen und Erklärungen an und wiederhole den Test später — Abstand hilft dem Gedächtnis." + tail;
      } else {
        msg.textContent = passed
          ? "Stark. Das Thema sitzt für heute."
          : "Gutes Üben. Lies die Erklärungen und komm morgen für eine Wiederholung zurück.";
      }
      result.appendChild(msg);
      result.removeAttribute("hidden");
      record(quiz, questions, correct, total, isExam);   // → localStorage / Feedback-Mail
      result.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    if (isExam) {
      var submit = el("button", "quiz-submit", "Auswerten");
      submit.type = "button";
      submit.addEventListener("click", function () {
        if (answered < total) {
          if (!confirm("Es sind noch " + (total - answered) +
              " Fragen offen. Trotzdem auswerten?")) return;
        }
        correct = 0;
        questions.forEach(function (q) {
          var ai = parseInt(q.getAttribute("data-answer"), 10);
          var opts = Array.prototype.slice.call(q.querySelectorAll(".quiz-opt"));
          var explain = q.querySelector(".quiz-explain");
          var right = q.chosen === ai;
          if (right) correct++;
          // Adaptiv: Score pro Frage fortschreiben (+1 richtig / -1 falsch).
          if (isAdaptive && q.chosen !== null) {
            lessonScores[q._qid] = clampScore((lessonScores[q._qid] || 0) + (right ? 1 : -1));
          }
          opts.forEach(function (o, k) {
            o.disabled = true;
            o.classList.remove("chosen");
            if (k === ai) o.classList.add("correct");
            if (k === q.chosen && !right) o.classList.add("incorrect");
          });
          if (explain) explain.classList.add("show");
        });
        if (isAdaptive) saveScores(scores);
        submit.disabled = true;
        showResult();
      });
      quiz.appendChild(submit);
    }

    var reset = el("button", "quiz-reset", "Nochmal versuchen");
    reset.type = "button";
    reset.addEventListener("click", function () { window.location.reload(); });
    quiz.appendChild(reset);
  }

  /* --------------- Erklärung + Lernstand (adaptiver Modus) -------------- */
  function renderAdaptiveIntro(quiz, pool, asked, totalPool) {
    // Vier Kategorien, die zusammen genau totalPool ergeben:
    var mastered = pool.filter(function (p) { return p.score >= MASTERED; }).length;
    var progress = pool.filter(function (p) { return p.score >= 1 && p.score < MASTERED; }).length;
    var fresh = pool.filter(function (p) { return p.score === 0; }).length;
    var hard = pool.filter(function (p) { return p.score <= -1; }).length;

    var box = el("div", "quiz-intro");
    box.innerHTML =
      '<span class="label">So funktioniert dieser Test</span>' +
      '<p>Statt aller <strong>' + totalPool + '</strong> Fragen auf einmal bekommst du pro ' +
      'Durchgang nur <strong>' + asked + '</strong> — gezielt ausgewählt. Jede Frage hat einen ' +
      'Lern-Score (Start 0): richtig beantwortet <strong>+1</strong>, falsch <strong>−1</strong>. ' +
      'Fragen mit niedrigem Score kommen deutlich häufiger dran, bei <strong>−3</strong> fast sicher. ' +
      'Erreicht eine Frage <strong>+3</strong>, gilt sie als gemeistert und fällt raus. ' +
      'Klick am Ende „Nochmal versuchen“ für den nächsten Durchgang — mit Abstand über mehrere ' +
      'Tage bleibt der Stoff am besten hängen.</p>' +
      '<p class="quiz-stand small">Dein Lernstand: <strong>' + mastered + '</strong> von ' +
      totalPool + ' gemeistert · ' + progress + ' auf gutem Weg · ' + fresh +
      ' noch offen · ' + hard + ' schwierig.' +
      ' <button type="button" class="quiz-reset-scores">Lernstand zurücksetzen</button></p>';
    quiz.parentNode.insertBefore(box, quiz);

    box.querySelector(".quiz-reset-scores").addEventListener("click", function () {
      if (!confirm("Lernstand für diesen Test wirklich zurücksetzen? Alle Scores gehen auf 0.")) return;
      var all = loadScores();
      delete all[scoreLessonId()];
      saveScores(all);
      window.location.reload();
    });
  }

  /* ------------------------------- RECALL ------------------------------- */
  function initRecall(card) {
    var a = card.querySelector(".r-a");
    if (a) a.style.display = "none";
    var hint = el("span", "r-hint", "▸ zum Aufdecken tippen");
    card.appendChild(hint);
    card.addEventListener("click", function () {
      var open = card.classList.toggle("open");
      if (a) a.style.display = open ? "block" : "none";
      hint.textContent = open ? "▾ verdecken" : "▸ zum Aufdecken tippen";
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".quiz").forEach(initQuiz);
    document.querySelectorAll(".recall").forEach(initRecall);
  });
})();
