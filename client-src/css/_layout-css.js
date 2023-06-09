import { css } from "lit";

export const LAYOUT_CSS = css`
.layout {
  display: flex;
}
.layout.wrap {
  flex-wrap: wrap;
}
.layout.center {
  align-items: center;
}
.layout.center-center {
  align-items: center;
  justify-content: center;
}
.layout.vertical {
  flex-direction: column;
}`;
