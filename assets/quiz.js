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
    var isExam = quiz.getAttribute("data-mode") === "exam";
    var pass = parseInt(quiz.getAttribute("data-pass") || "80", 10);
    var questions = Array.prototype.slice.call(quiz.querySelectorAll(".quiz-q"));
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
        msg.textContent = passed
          ? "Bestanden — und zwar souverän. Geh die falsch beantworteten Fragen unten noch einmal durch, dann sitzt es."
          : "Noch nicht ganz. Schau dir die markierten Fragen und Erklärungen an und wiederhole den Test später — Abstand hilft dem Gedächtnis.";
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
          opts.forEach(function (o, k) {
            o.disabled = true;
            o.classList.remove("chosen");
            if (k === ai) o.classList.add("correct");
            if (k === q.chosen && !right) o.classList.add("incorrect");
          });
          if (explain) explain.classList.add("show");
        });
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
