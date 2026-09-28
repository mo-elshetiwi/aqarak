import type { ReactElement } from "react";

/** Applies a saved preference before the first paint without request-time data. */
export function ThemeScript(): ReactElement {
  const script = `(function(){try{var t=localStorage.getItem('aqarak-theme');document.documentElement.classList.remove('light','dark');if(t==='light'||t==='dark')document.documentElement.classList.add(t)}catch{}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
