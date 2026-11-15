import { mountSiteHeader, refreshSiteHeader } from "./siteHeader";

mountSiteHeader("landing");

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

const dialog = document.querySelector<HTMLDialogElement>("#desktop-dialog")!;
const intro = document.querySelector<HTMLElement>("#intro")!;

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
    "Watch introductory film";

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
            refreshSiteHeader();
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
