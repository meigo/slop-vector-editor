export const TAB_CHANNEL = "slop-vector-editor";

/** Autosave is one shared IndexedDB record, so two open tabs overwrite each other. Each tab says
 *  "hello" on start; any other tab answers "here"; both sides then warn once. */
export function watchOtherTabs(onOther: () => void, channelName = TAB_CHANNEL): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(channelName);
  let warned = false;
  const warn = () => {
    if (warned) return;
    warned = true;
    onOther();
  };
  channel.onmessage = (e: MessageEvent) => {
    if (e.data === "hello") {
      channel.postMessage("here");
      warn();
    } else if (e.data === "here") {
      warn();
    }
  };
  channel.postMessage("hello");
  return () => channel.close();
}
