import { analyze } from "./engine.js?v=5";

self.onmessage = (e) => {
  const { id, input } = e.data;
  try {
    self.postMessage({ id, out: analyze(input) });
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
