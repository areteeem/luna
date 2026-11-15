import { canLaunchNavigator, navigatorPath } from "./desktopAccess";

type YouTubePlayerEvent = { data: number };
type YouTubePlayer = { destroy: () => void };
type YouTubeApi = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars: Record<string, string | number>;
      events: { onStateChange: (event: YouTubePlayerEvent) => void };
    },
  ) => YouTubePlayer;
  PlayerState: { ENDED: number };
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const header = document.querySelector<HTMLElement>("[data-header]")!;
const launchLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("main [data-launch]"));
const tintedSections = Array.from(document.querySelectorAll<HTMLElement>("[data-dark], .pale"));
const mobileMenu = document.querySelector<HTMLElement>(".mobile-menu")!;
const mobileMenuToggle = mobileMenu.querySelector<HTMLButtonElement>(".menu-toggle")!;
const mobileMenuPanel = mobileMenu.querySelector<HTMLElement>("nav")!;
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
  if (mobileMenu.classList.contains("is-open") && (!mobileMenu.contains(target) || target.closest(".mobile-menu a"))) {
    setMobileMenuOpen(false);
  }
  if (target.closest("[data-launch]") && !canLaunchNavigator()) {
    event.preventDefault();
    showDesktopAccess();
  }
});

function setMobileMenuOpen(open: boolean) {
  mobileMenu.classList.toggle("is-open", open);
  mobileMenuToggle.setAttribute("aria-expanded", String(open));
  mobileMenuToggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
  mobileMenuPanel.setAttribute("aria-hidden", String(!open));
  mobileMenuPanel.inert = !open;
  if (open) requestAnimationFrame(() => mobileMenuPanel.querySelector<HTMLElement>("a")?.focus());
  else mobileMenuToggle.focus({ preventScroll: true });
}

mobileMenuToggle.addEventListener("click", () => {
  setMobileMenuOpen(!mobileMenu.classList.contains("is-open"));
});

mobileMenu.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !mobileMenu.classList.contains("is-open")) return;
  setMobileMenuOpen(false);
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

const youtubeId = "R3W25BC510k";
if (/^[\w-]{11}$/.test(youtubeId)) {
  const stage = document.querySelector<HTMLElement>("[data-film-stage]")!;
  const play = document.querySelector<HTMLButtonElement>("[data-film-play]")!;
  const launch = document.querySelector<HTMLAnchorElement>("[data-film-launch]")!;
  const actions = document.querySelector<HTMLElement>("[data-film-actions]")!;
  const poster = stage.querySelector<HTMLImageElement>("img")!;

  let youtubeApiPromise: Promise<YouTubeApi> | undefined;
  const loadYouTubeApi = () => {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (youtubeApiPromise) return youtubeApiPromise;
    youtubeApiPromise = new Promise<YouTubeApi>((resolve, reject) => {
      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previousReady?.();
        if (window.YT) resolve(window.YT);
        else reject(new Error("YouTube player API did not initialize."));
      };
      let script = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
      if (!script) {
        script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.onerror = () => reject(new Error("YouTube player API could not load."));
        document.head.append(script);
      }
    });
    return youtubeApiPromise;
  };

  for (const link of document.querySelectorAll("[data-film-link]")) {
    link.firstChild!.textContent = "Watch the Film ";
  }

  stage.classList.add("has-film");
  play.hidden = false;
  document.querySelector("[data-film-description]")!.textContent =
    "Watch a 38-second tour of the lunar navigator and site planning workspace.";

  play.addEventListener("click", () => {
    play.hidden = true;
    poster.hidden = true;
    const playerMount = document.createElement("div");
    playerMount.className = "film-player";
    stage.append(playerMount);
    void loadYouTubeApi().then((YT) => {
      new YT.Player(playerMount, {
        videoId: youtubeId,
        playerVars: { autoplay: 1, start: 0, end: 38, controls: 1, rel: 0, enablejsapi: 1 },
        events: {
          onStateChange: (event) => {
            if (event.data !== YT.PlayerState.ENDED) return;
            actions.hidden = false;
            launch.hidden = false;
            requestHeaderUpdate();
          },
        },
      });
    }).catch((error: unknown) => {
      console.error(error);
      playerMount.remove();
      poster.hidden = false;
      play.hidden = false;
    });
  }, { once: true });
}
