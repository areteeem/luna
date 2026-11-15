import { canLaunchNavigator, navigatorPath } from "./desktopAccess";

type SitePage = "landing" | "science";

let header: HTMLElement | null = null;
let headerFrame = 0;

const basePath = import.meta.env.BASE_URL;
const page = (name: string) => `${basePath}${name}`;

function headerLink(label: string, href: string, current = false) {
  return `<a href="${href}"${current ? ' aria-current="page"' : ""}>${label}</a>`;
}

export function mountSiteHeader(activePage: SitePage) {
  const root = document.querySelector<HTMLElement>("[data-site-header-root]");
  if (!root) return;

  const landing = activePage === "landing";
  const links = [
    headerLink("Explore", landing ? "#explore" : `${page("index.html")}#explore`),
    headerLink("The Mission", landing ? "#mission" : `${page("index.html")}#mission`),
    headerLink("How It Works", landing ? "#how-it-works" : `${page("index.html")}#how-it-works`),
    headerLink("Science", page("science.html"), !landing),
    headerLink("About", landing ? "#about" : `${page("index.html")}#about`),
  ].join("");

  root.innerHTML = `<header class="site-header" data-header>
    <div class="nav-shell">
      <a class="wordmark" href="${page("index.html")}#explore" aria-label="LUNA home">
        <img class="mark-light" src="${page("landing/nav-light.webp")}" alt="" width="104" height="104" />
        <img class="mark-dark" src="${page("landing/nav-dark.webp")}" alt="" width="104" height="104" />
      </a>
      <nav class="primary-nav" aria-label="Main navigation">${links}</nav>
      <a class="button nav-launch" href="${navigatorPath}" data-launch>Launch LUNA <span aria-hidden="true">↗</span></a>
      <div class="mobile-menu">
        <button class="menu-toggle" type="button" aria-controls="mobile-navigation" aria-label="Open navigation menu" aria-expanded="false"><span></span><span></span></button>
        <nav id="mobile-navigation" aria-label="Mobile navigation" aria-hidden="true" inert>${links}</nav>
      </div>
    </div>
  </header>`;
  header = root.querySelector<HTMLElement>("[data-header]");

  const mobileMenu = root.querySelector<HTMLElement>(".mobile-menu")!;
  const toggle = mobileMenu.querySelector<HTMLButtonElement>(".menu-toggle")!;
  const panel = mobileMenu.querySelector<HTMLElement>("nav")!;
  const setMenuOpen = (open: boolean, restoreFocus = true) => {
    mobileMenu.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
    panel.setAttribute("aria-hidden", String(!open));
    panel.inert = !open;
    if (open) requestAnimationFrame(() => panel.querySelector<HTMLElement>("a")?.focus());
    else if (restoreFocus) toggle.focus({ preventScroll: true });
  };

  toggle.addEventListener("click", () => setMenuOpen(!mobileMenu.classList.contains("is-open")));
  mobileMenu.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mobileMenu.classList.contains("is-open")) setMenuOpen(false);
  });
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof Node && mobileMenu.classList.contains("is-open") && !mobileMenu.contains(target)) {
      setMenuOpen(false);
    }
    if (target instanceof Element && target.closest(".mobile-menu a")) setMenuOpen(false, false);
    if (target instanceof Element && target.closest("[data-launch]") && !canLaunchNavigator()) {
      event.preventDefault();
      showDesktopAccess();
    }
  });
  window.matchMedia("(min-width: 681px)").addEventListener("change", () => setMenuOpen(false, false));

  mountDesktopDialog();
  window.addEventListener("scroll", requestHeaderUpdate, { passive: true });
  window.addEventListener("resize", requestHeaderUpdate);
  window.addEventListener("pageshow", requestHeaderUpdate);
  document.fonts.ready.then(requestHeaderUpdate);
  requestHeaderUpdate();

  const currentUrl = new URL(window.location.href);
  if (currentUrl.searchParams.has("desktop")) {
    currentUrl.searchParams.delete("desktop");
    history.replaceState(history.state, "", currentUrl);
    showDesktopAccess();
  }
}

function requestHeaderUpdate() {
  if (!header || headerFrame) return;
  headerFrame = window.requestAnimationFrame(updateHeader);
}

function updateHeader() {
  headerFrame = 0;
  if (!header) return;
  const height = header.offsetHeight;
  const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-dark], .pale"));
  const sectionBelow = sections.find((section) => {
    const bounds = section.getBoundingClientRect();
    return bounds.top <= height / 2 && bounds.bottom >= height / 2;
  });
  const launchLinks = document.querySelectorAll<HTMLAnchorElement>("main [data-launch]");
  const launchInView = Array.from(launchLinks).some((link) => {
    const bounds = link.getBoundingClientRect();
    return bounds.top >= height && bounds.bottom <= window.innerHeight;
  });
  header.toggleAttribute("data-dark-header", Boolean(sectionBelow?.hasAttribute("data-dark")));
  header.toggleAttribute("data-pale-header", Boolean(sectionBelow?.classList.contains("pale")));
  header.toggleAttribute("data-scrolled", window.scrollY > 8);
  header.toggleAttribute("data-show-launch", !launchInView);
}

function mountDesktopDialog() {
  if (document.querySelector("#desktop-dialog")) return;
  document.body.insertAdjacentHTML("beforeend", `<dialog class="desktop-dialog" id="desktop-dialog" aria-labelledby="desktop-title" aria-describedby="desktop-description">
    <div class="desktop-card">
      <p class="eyebrow">LUNA Navigator</p>
      <h2 id="desktop-title">Continue your exploration on desktop.</h2>
      <p id="desktop-description">LUNA’s interactive navigator is designed for a larger screen. Open this address on your computer to begin.</p>
      <input id="desktop-address" aria-label="Desktop navigator URL" readonly spellcheck="false" />
      <p class="local-note" data-local-note hidden>This local address opens on the computer running LUNA.</p>
      <div class="actions"><button class="button" type="button" data-copy autofocus>Copy URL</button><form method="dialog"><button class="text-link" type="submit">Return to Website</button></form></div>
      <p class="copy-status" aria-live="polite"></p>
    </div>
  </dialog>`);
  document.querySelector<HTMLButtonElement>("[data-copy]")?.addEventListener("click", async () => {
    const address = document.querySelector<HTMLInputElement>("#desktop-address")!;
    const status = document.querySelector<HTMLElement>(".copy-status")!;
    try {
      await navigator.clipboard.writeText(address.value);
      status.textContent = "URL copied.";
    } catch {
      address.focus();
      address.select();
      status.textContent = "Address selected. Use your device’s Copy command.";
    }
  });
}

function showDesktopAccess() {
  const dialog = document.querySelector<HTMLDialogElement>("#desktop-dialog");
  if (!dialog) return;
  const address = document.querySelector<HTMLInputElement>("#desktop-address")!;
  address.value = new URL(navigatorPath, window.location.href).href;
  document.querySelector<HTMLElement>("[data-local-note]")!.hidden =
    !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  document.querySelector<HTMLElement>(".copy-status")!.textContent = "";
  dialog.showModal();
}

export function refreshSiteHeader() {
  requestHeaderUpdate();
}
