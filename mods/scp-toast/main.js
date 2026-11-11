// Notifications as Foundation memos: paper sheet, black header strip, red edge.
// Anything can post one with notify({ title, body, level, icon, action }).

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run } from "herdr";

const MONO = "JetBrains Mono";
const LEVEL = {
  error: { tag: "BREACH NOTICE", color: "#c8102e" },
  warning: { tag: "CAUTION", color: "#8a5d00" },
  success: { tag: "RECONTAINED", color: "#3f6b27" },
  info: { tag: "INTERNAL MEMO", color: "#c8102e" },
};

export default class Toast extends View {
  render(cx) {
    const p = props() ?? {};
    const L = LEVEL[p.level] ?? LEVEL.info;
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;
    const title = login ? `${login[1]} needs a login: run` : p.title ?? "";

    return h_flex().id("toast").size_full().bg("#d6d6cf").border(1).border_color("#0c0d0d")
      .cursor_pointer().hover((s) => s.opacity(0.92))
      .on_click(() => {
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      })
      .child(div().w(6).h_full().flex_none().bg(L.color))
      .child(v_flex().flex_1().min_w(0).h_full()
        .child(h_flex().w_full().h(16).flex_none().px(10).items_center().bg("#0c0d0d")
          .child(div().font_family(MONO).font_weight(800).text_size(9).text_color("#d6d6cf").child(`${L.tag} · SCP FOUNDATION`)))
        .child(h_flex().flex_1().px(10).gap(10).items_center().min_w(0)
          .when(Boolean(p.icon), (el) => el.child(image(p.icon).w(18).h(18).flex_none()))
          .child(v_flex().flex_1().min_w(0).overflow_hidden()
            .child(div().truncate().font_family(MONO).font_weight(800).text_size(12).text_color("#0c0d0d").child(title))
            .when(!login && Boolean(p.body), (el) => el.child(div().truncate().font_family(MONO).text_size(10.5).text_color("#3a3d3c").child(p.body ?? "")))
            .when(Boolean(login), (el) => el.child(h_flex().gap(8).items_center()
              .child(div().flex_1().min_w(0).truncate().tooltip(command).font_family(MONO).text_size(10.5).text_color("#3a3d3c").child(command))
              .child(div().id("toast-login-copy").flex_none().px(6).py(2).bg("#0c0d0d").cursor_pointer()
                .font_family(MONO).font_weight(800).text_size(10).text_color("#d6d6cf")
                .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = true; cx.notify(); })
                .child(this.copied ? "COPIED" : "COPY")))))));
  }
}
