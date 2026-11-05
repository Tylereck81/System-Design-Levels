// Workload pieces that several levels share. Each is made by a function, so every level gets its own copy.
// Pure: nothing here reads game state.

/** The shop's product catalog the cache holds: its size, and how often a cached product is read. */
export const catalogWorkload = () => ({ catalogGB: 20, readGapSecs: 10 });

/** The catalog plus the shop's static files: their size, and how often each file is requested. */
export const filesWorkload = () => ({ ...catalogWorkload(), fileKB: 20, fileGapSecs: 30 });

/** Traffic over a day as a share of the 20:00 peak, hour by hour. It averages half the peak. */
export const dayTraffic = () => [
  0.40, 0.30, 0.22, 0.18, 0.15, 0.16, 0.22, 0.32, 0.42, 0.49, 0.54, 0.56, // 00:00 to 11:00
  0.61, 0.57, 0.54, 0.52, 0.54, 0.61, 0.71, 0.86, 1.00, 0.88, 0.70, 0.50, // 12:00 to 23:00
];
