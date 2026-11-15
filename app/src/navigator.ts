import { canLaunchNavigator } from "./desktopAccess";

async function openNavigator() {
  if (!canLaunchNavigator()) {
    window.location.replace(`${import.meta.env.BASE_URL}?desktop=1`);
    return;
  }

  const cesiumBase = `${import.meta.env.BASE_URL}cesium/`;
  const widgets = document.createElement("link");
  widgets.rel = "stylesheet";
  widgets.href = `${cesiumBase}Widgets/widgets.css`;
  document.head.append(widgets);

  if (import.meta.env.PROD) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${cesiumBase}Cesium.js`;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load Cesium."));
      document.head.append(script);
    });
  }

  await import("./main");
  document.getElementById("navigator-status")?.remove();
}

void openNavigator().catch((error: unknown) => {
  console.error(error);
  const status = document.getElementById("navigator-status");
  if (status?.firstChild) status.firstChild.textContent = "LUNA Navigator could not start. ";
});
