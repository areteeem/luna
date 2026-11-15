import { canLaunchNavigator, navigatorPath } from "./desktopAccess";

const header = document.querySelector<HTMLElement>("[data-header]")!;
const launchLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("main [data-launch]"));
const tintedSections = Array.from(document.querySelectorAll<HTMLElement>("[data-dark], .pale"));
const mobileMenu = document.querySelector<HTMLDetailsElement>(".mobile-menu")!;
const dialog = document.querySelector<HTMLDialogElement>("#desktop-dialog")!;
const address = document.querySelector<HTMLInputElement>("#desktop-address")!;
const copyStatus = document.querySelector<HTMLElement>(".copy-status")!;
const intro = document.querySelector<HTMLElement>("#intro")!;

let headerFrame = 0;
function updateHeader() {
  headerFrame = 0;
  const headerHeight = header.offsetHeight;
  const sectionBelow = tintedSections.find((section) => {
    const bounds = section.getBoundingClientRect();
    return bounds.top <= headerHeight / 2 && bounds.bottom >= headerHeight / 2;
  });
  const launchInView = launchLinks.some((link) => {
    const bounds = link.getBoundingClientRect();
    return bounds.top >= headerHeight && bounds.bottom <= window.innerHeight;
  });
  header.toggleAttribute("data-dark-header", Boolean(sectionBelow?.hasAttribute("data-dark")));
  header.toggleAttribute("data-pale-header", Boolean(sectionBelow?.classList.contains("pale")));
  header.toggleAttribute("data-scrolled", window.scrollY > 8);
  header.toggleAttribute("data-show-launch", !launchInView);
}

function requestHeaderUpdate() {
  if (!headerFrame) headerFrame = window.requestAnimationFrame(updateHeader);
}

window.addEventListener("scroll", requestHeaderUpdate, { passive: true });
window.addEventListener("resize", requestHeaderUpdate);
window.addEventListener("pageshow", requestHeaderUpdate);
document.fonts.ready.then(requestHeaderUpdate);
updateHeader();

function showDesktopAccess() {
  address.value = new URL(navigatorPath, window.location.href).href;
  document.querySelector<HTMLElement>("[data-local-note]")!.hidden =
    !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  copyStatus.textContent = "";
  dialog.showModal();
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!mobileMenu.contains(target) || target.closest(".mobile-menu a")) {
    mobileMenu.open = false;
    mobileMenu.querySelector("summary")?.setAttribute("aria-expanded", "false");
    mobileMenu.querySelector("summary")?.setAttribute("aria-label", "Open navigation menu");
  }
  if (target.closest("[data-launch]") && !canLaunchNavigator()) {
    event.preventDefault();
    showDesktopAccess();
  }
});

mobileMenu.querySelector("summary")!.addEventListener("click", () => {
  requestAnimationFrame(() => {
    const summary = mobileMenu.querySelector("summary")!;
    summary.setAttribute("aria-expanded", String(mobileMenu.open));
    summary.setAttribute("aria-label", mobileMenu.open ? "Close navigation menu" : "Open navigation menu");
    if (mobileMenu.open) {
      mobileMenu.querySelector<HTMLElement>("nav a")?.focus();
    }
  });
});

mobileMenu.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !mobileMenu.open) return;
  mobileMenu.open = false;
  mobileMenu.querySelector("summary")?.setAttribute("aria-expanded", "false");
  mobileMenu.querySelector("summary")?.setAttribute("aria-label", "Open navigation menu");
  mobileMenu.querySelector("summary")?.focus();
});

document.querySelector("[data-copy]")!.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(address.value);
    copyStatus.textContent = "URL copied.";
  } catch {
    address.focus();
    address.select();
    copyStatus.textContent = "Address selected. Use your device’s Copy command.";
  }
});

const pageUrl = new URL(window.location.href);
if (pageUrl.searchParams.has("desktop")) {
  pageUrl.searchParams.delete("desktop");
  history.replaceState(history.state, "", pageUrl);
  showDesktopAccess();
}

try {
  if (!sessionStorage.getItem("luna-landing-intro")) {
    sessionStorage.setItem("luna-landing-intro", "seen");
    if (!dialog.open && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      intro.hidden = false;
      const finishIntro = () => { intro.hidden = true; };
      intro.addEventListener("animationend", (event) => {
        if (event.target === intro) finishIntro();
      });
      window.addEventListener("keydown", finishIntro, { once: true });
      window.addEventListener("pointerdown", finishIntro, { once: true });
      window.setTimeout(finishIntro, 1050);
    }
  }
} catch {}

const horizon = document.querySelector<HTMLImageElement>("[data-horizon-image]")!;
const horizonToggle = document.querySelector<HTMLButtonElement>("[data-horizon-toggle]")!;
const horizonState = document.querySelector<HTMLElement>("[data-horizon-state]")!;
const earthHorizon = horizon.src;
const earthAlt = horizon.alt;
let showingSun = false;

horizonToggle.hidden = false;
horizonToggle.addEventListener("click", () => {
  showingSun = !showingSun;
  horizon.src = showingSun ? horizon.dataset.sunImage! : earthHorizon;
  horizon.alt = showingSun
    ? "The Sun grazing the lunar horizon as Earth sits low beside it in a NASA visualization"
    : earthAlt;
  horizonState.textContent = showingSun ? "Sun grazing the horizon" : "Earth above the horizon";
  horizonToggle.firstChild!.textContent = showingSun ? "Show Earth " : "Show the Sun ";
});

const youtubeId = import.meta.env.VITE_LUNA_YOUTUBE_ID;
if (typeof youtubeId === "string" && /^[\w-]{11}$/.test(youtubeId)) {
  const stage = document.querySelector<HTMLElement>("[data-film-stage]")!;
  const play = document.querySelector<HTMLButtonElement>("[data-film-play]")!;
  const next = document.querySelector<HTMLAnchorElement>("[data-film-next]")!;
  const launch = document.querySelector<HTMLAnchorElement>("[data-film-launch]")!;

  for (const link of document.querySelectorAll("[data-film-link]")) {
    link.firstChild!.textContent = "Watch the Film ";
  }

  stage.classList.add("has-film");
  play.hidden = false;
  document.querySelector("[data-film-description]")!.textContent =
    "A three-minute demonstration of LUNA’s lunar planning workspace.";

  play.addEventListener("click", () => {
    const player = document.createElement("iframe");
    player.src = `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0&cc_load_policy=1`;
    player.title = "LUNA project demonstration";
    player.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    player.allowFullscreen = true;
    stage.replaceChildren(player);
    launch.hidden = false;
    requestHeaderUpdate();
    next.textContent = "Watch on YouTube ↗";
    next.href = `https://www.youtube.com/watch?v=${youtubeId}`;
    player.focus();
  }, { once: true });
}
