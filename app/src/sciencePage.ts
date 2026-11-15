import { render } from "katex";
import "katex/dist/katex.min.css";
import { mountSiteHeader } from "./siteHeader";

mountSiteHeader("science");

const gallery = document.querySelector<HTMLElement>("[data-formula-gallery]");
const track = gallery?.querySelector<HTMLElement>("[data-formula-track]");
const cards = track ? Array.from(track.querySelectorAll<HTMLElement>("[data-formula-card]")) : [];
const count = gallery?.querySelector<HTMLElement>("[data-formula-count]");
const previous = gallery?.querySelector<HTMLButtonElement>("[data-formula-previous]");
const next = gallery?.querySelector<HTMLButtonElement>("[data-formula-next]");
const dots = gallery?.querySelector<HTMLElement>("[data-formula-dots]");
let active = 0;

const equations = Array.from(document.querySelectorAll<HTMLElement>("[data-katex]"));
for (const target of equations) {
  const source = target.dataset.katex;
  if (source) render(source, target, { displayMode: true, throwOnError: false, strict: "ignore" });
}

function fitEquations() {
  for (const target of equations) {
    const math = target.querySelector<HTMLElement>(".katex");
    if (!math || target.clientWidth < 1 || target.clientHeight < 1) continue;
    target.style.fontSize = "";
    const baseSize = Number.parseFloat(getComputedStyle(target).fontSize);
    const availableWidth = Math.max(1, target.clientWidth - 16);
    const availableHeight = Math.max(1, target.clientHeight - 12);
    const scale = Math.min(1, availableWidth / math.scrollWidth, availableHeight / math.scrollHeight);
    target.style.fontSize = `${Math.max(10, baseSize * scale * 0.98)}px`;
  }
}

let fitFrame = 0;
const scheduleEquationFit = () => {
  if (fitFrame) return;
  fitFrame = requestAnimationFrame(() => { fitFrame = 0; fitEquations(); });
};
requestAnimationFrame(fitEquations);
document.fonts.ready.then(scheduleEquationFit);
window.addEventListener("resize", scheduleEquationFit);
if ("ResizeObserver" in window) {
  const equationObserver = new ResizeObserver(scheduleEquationFit);
  equations.forEach((equation) => equationObserver.observe(equation));
}

if (gallery && track && cards.length && count && previous && next && dots) {
  dots.innerHTML = cards.map((_, index) => `<button type="button" aria-label="Show formula ${index + 1}" data-formula-dot="${index}"></button>`).join("");
  const dotButtons = Array.from(dots.querySelectorAll<HTMLButtonElement>("[data-formula-dot]"));
  const setActive = (index: number) => {
    active = Math.max(0, Math.min(cards.length - 1, index));
    count.textContent = `${String(active + 1).padStart(2, "0")} / ${String(cards.length).padStart(2, "0")}`;
    previous.disabled = active === 0;
    next.disabled = active === cards.length - 1;
    cards.forEach((card, cardIndex) => {
      card.toggleAttribute("data-active", cardIndex === active);
      card.setAttribute("aria-hidden", String(cardIndex !== active));
    });
    dotButtons.forEach((dot, dotIndex) => {
      dot.toggleAttribute("aria-current", dotIndex === active);
      dot.setAttribute("aria-pressed", String(dotIndex === active));
    });
  };
  const goTo = (index: number) => {
    const targetIndex = Math.max(0, Math.min(cards.length - 1, index));
    cards[targetIndex]?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest", inline: "start" });
    setActive(targetIndex);
  };
  previous.addEventListener("click", () => goTo(active - 1));
  next.addEventListener("click", () => goTo(active + 1));
  dotButtons.forEach((dot, index) => dot.addEventListener("click", () => goTo(index)));
  track.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") { event.preventDefault(); goTo(active + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); goTo(active - 1); }
  });

  const observer = new IntersectionObserver((entries) => {
    const mostVisible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (mostVisible) setActive(cards.indexOf(mostVisible.target as HTMLElement));
  }, { root: track, threshold: [0.55, 0.8] });
  cards.forEach((card) => observer.observe(card));
  setActive(0);
}
