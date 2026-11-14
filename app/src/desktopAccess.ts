export const navigatorPath = `${import.meta.env.BASE_URL}navigator.html`;
export const desktopViewport = window.matchMedia("(min-width: 768px)");
const compactTouch = window.matchMedia("(max-width: 1023px) and (pointer: coarse) and (hover: none)");

export function canLaunchNavigator() {
  return desktopViewport.matches && !compactTouch.matches;
}
