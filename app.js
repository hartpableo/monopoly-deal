// Monopoly Deal - Client Entry Point
import { initApp } from "./js/index.js";

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
