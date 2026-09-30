export {};
declare global {
  interface Window {
    /** 调试/测试钩子 */
    __cam?: { camera: unknown; controls: unknown; scene: unknown };
  }
}
