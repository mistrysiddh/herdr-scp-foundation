// Notifications as Foundation memos: paper sheet, black header strip, red edge.
// Anything can post one with notify({ title, body, level, icon, action }).

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, shared } from "herdr";

const MONO = "JetBrains Mono";
// Department colours (shared "scp.dept", set by the scp mod): accent, paper, ink, ink2, text-on-ink.
const DEPT = [
  { accent: "#c8102e", paper: "#d6d6cf", ink: "#0c0d0d", ink2: "#3a3d3c", strip: "#0c0d0d", stripText: "#d6d6cf", warn: "#8a5d00", ok: "#3f6b27" },
  { accent: "#5f8f3f", paper: "#cfd6c6", ink: "#0b0e0a", ink2: "#354031", strip: "#0b0e0a", stripText: "#cfd6c6", warn: "#8a5d00", ok: "#3f6b27" },
  { accent: "#4f7f9c", paper: "#ccd3d9", ink: "#0c0e10", ink2: "#36404a", strip: "#0c0e10", stripText: "#ccd3d9", warn: "#8a5d00", ok: "#3f6b27" },
  { accent: "#d9a21b", paper: "#14120a", ink: "#e8d9a0", ink2: "#a89a62", strip: "#d9a21b", stripText: "#120f05", warn: "#d9a21b", ok: "#8fbf6e" },
];
const dept = () => DEPT[Math.min(DEPT.length - 1, Math.max(0, Math.round(Number(shared("scp.dept")) || 0)))];
const levelOf = (D, level) => ({
  error: { tag: "BREACH NOTICE", color: D.accent },
  warning: { tag: "CAUTION", color: D.warn },
  success: { tag: "RECONTAINED", color: D.ok },
  info: { tag: "INTERNAL MEMO", color: D.accent },
}[level] ?? { tag: "INTERNAL MEMO", color: D.accent });

export default class Toast extends View {
  render(cx) {
    const p = props() ?? {};
    const D = dept();
    const L = levelOf(D, p.level);
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;
    const title = login ? `${login[1]} needs a login: run` : p.title ?? "";

    return h_flex().id("toast").size_full().bg(D.paper).border(1).border_color(D.ink2)
      .cursor_pointer().hover((s) => s.opacity(0.92))
      .on_click(() => {
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      })
      .child(div().w(6).h_full().flex_none().bg(L.color))
      .child(v_flex().flex_1().min_w(0).h_full()
        .child(h_flex().w_full().h(16).flex_none().px(10).items_center().bg(D.strip)
          .child(div().font_family(MONO).font_weight(800).text_size(9).text_color(D.stripText).child(`${L.tag} · SCP FOUNDATION`)))
        .child(h_flex().flex_1().px(10).gap(10).items_center().min_w(0)
          .when(Boolean(p.icon), (el) => el.child(image(p.icon).w(18).h(18).flex_none()))
          .child(v_flex().flex_1().min_w(0).overflow_hidden()
            .child(div().truncate().font_family(MONO).font_weight(800).text_size(12).text_color(D.ink).child(title))
            .when(!login && Boolean(p.body), (el) => el.child(div().truncate().font_family(MONO).text_size(10.5).text_color(D.ink2).child(p.body ?? "")))
            .when(Boolean(login), (el) => el.child(h_flex().gap(8).items_center()
              .child(div().flex_1().min_w(0).truncate().tooltip(command).font_family(MONO).text_size(10.5).text_color(D.ink2).child(command))
              .child(div().id("toast-login-copy").flex_none().px(6).py(2).bg(D.strip).cursor_pointer()
                .font_family(MONO).font_weight(800).text_size(10).text_color(D.stripText)
                .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = true; cx.notify(); })
                .child(this.copied ? "COPIED" : "COPY")))))));
  }
}
