// Lucide 图标组件：<AppIcon name="trash-2" /> / <AppIcon name="play" :size="18" />
// 取代 Element Plus 图标（element-plus-icons.iife.min.js，202KB）。
// 无构建：用 Vue 全局构建的 h()，不能写 JSX。
const { h } = window.Vue;

const warned = new Set();

export const AppIcon = {
  name: 'AppIcon',
  props: {
    name: { type: String, required: true },
    size: { type: [Number, String], default: 0 },
    strokeWidth: { type: [Number, String], default: 1.75 },
  },
  setup(props) {
    return () => {
      const store = window.__FREEDOM_LUCIDE_ICONS__;
      const inner = store && store[props.name];
      if (!inner) {
        if (props.name && !warned.has(props.name)) {
          warned.add(props.name);
          console.warn(`[AppIcon] 未找到图标：${props.name}`);
        }
        return null;
      }
      return h('svg', {
        class: 'app-icon',
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': String(props.strokeWidth),
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
        style: props.size ? { width: `${props.size}px`, height: `${props.size}px` } : undefined,
        innerHTML: inner,
      });
    };
  },
};

export function registerIconComponents(app) {
  app.component('AppIcon', AppIcon);
  return app;
}
