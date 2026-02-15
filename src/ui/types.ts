import { UiInsets, UiRect, ViewerUiComponentState, ViewerUiPointerEvent, ViewerUiPointerResult } from "../types.js";

export interface UiComponentHostOptions {
  onRequestRender: () => void;
}

export interface UiComponentLayoutState {
  reservedInsets: UiInsets;
  plotRect: UiRect;
}

export interface UiComponentHandleResult extends ViewerUiPointerResult {
  requestRender?: boolean;
}

export interface ViewerUiHandleComponent {
  handlePointerEvent(evt: ViewerUiPointerEvent): UiComponentHandleResult;
}

export const ZERO_INSETS: UiInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export const cloneInsets = (insets: UiInsets): UiInsets => ({
  top: insets.top,
  right: insets.right,
  bottom: insets.bottom,
  left: insets.left
});

export const sameInsets = (a: UiInsets, b: UiInsets): boolean => {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
};

export const buildUiState = (
  width: number,
  height: number,
  devicePixelRatio: number,
  channels: ViewerUiComponentState["channels"],
  channelToolbar: ViewerUiComponentState["channelToolbar"],
  plotRect: UiRect
): ViewerUiComponentState => ({
  width,
  height,
  devicePixelRatio,
  channels,
  channelToolbar,
  plotRect
});
