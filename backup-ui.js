import {exportBackup, maxBackupBytes, parseBackup, restoreBackup} from "./local-backup.js";

const offlineCacheVersion = "zenith-sudoku-cache-1.1.0-iphone1";

function checkOffline() {
  if (!globalThis.isSecureContext) return Promise.resolve("首次准备离线资源需要 HTTPS。");
  if (!navigator.serviceWorker?.controller) return Promise.resolve("正在准备离线资源，请保持联网。");

  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      resolve("离线资源尚未就绪，请稍后再试。");
    }, 1200);
    channel.port1.onmessage = event => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(event.data?.ready && event.data.version === offlineCacheVersion
        ? "离线资源已准备好"
        : "离线资源尚未就绪，请保持联网。");
    };
    navigator.serviceWorker.controller.postMessage({type: "sudoku-offline-status"}, [channel.port2]);
  });
}

function downloadBackup() {
  const text = exportBackup();
  const url = URL.createObjectURL(new Blob([text], {type: "application/json"}));
  const link = document.createElement("a");
  link.download = `信为美数独备份-${new Date().toISOString().slice(0, 10)}.json`;
  link.href = url;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function BackupPanel({React, jsx, colors}) {
  const {useEffect, useRef, useState} = React;
  const {jsx: element, jsxs: group} = jsx;
  const input = useRef(null);
  const [status, setStatus] = useState("正在检查离线资源。");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(null);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const message = await checkOffline().catch(() => "暂时无法检查离线资源。");
      if (mounted) setStatus(message);
    };
    check();
    const timer = setInterval(check, 2500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  async function chooseFile(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setPending(null);
    try {
      if (file.size > maxBackupBytes) throw new Error("备份文件超过大小限制。");
      const text = await file.text();
      const backup = parseBackup(text);
      setPending({text, fileName: file.name, time: new Date(backup.savedAt).toLocaleString("zh-CN")});
      setNotice("");
    } catch (error) {
      setNotice(error.message || "无法读取所选文件。");
    }
  }

  function confirmRestore() {
    try {
      restoreBackup(pending.text);
      location.reload();
    } catch {
      setNotice("恢复失败，请检查本机存储空间后重试。");
    }
  }

  const button = (label, onClick, primary = false) => element("button", {
    type: "button",
    onClick,
    style: {backgroundColor: primary ? colors.primary : colors.surfaceContainer, color: primary ? colors.onPrimary : colors.primary},
    className: "px-3 py-2 rounded-xl text-xs font-semibold active:scale-95",
    children: label,
  });

  return group("section", {
    style: {backgroundColor: colors.surface, borderColor: colors.surfaceBorder},
    className: "border rounded-2xl p-4 flex flex-col gap-3 shadow-xs",
    children: [
      element("h2", {style: {color: colors.text}, className: "text-sm font-bold", children: "离线与备份"}),
      element("p", {style: {color: colors.textMuted}, className: "text-xs", role: "status", children: status}),
      group("div", {
        className: "flex flex-wrap gap-2",
        children: [
          button("导出备份", () => {
            try {
              downloadBackup();
              setNotice("备份已交给浏览器保存。");
            } catch (error) {
              setNotice(error.message || "暂时无法导出备份。");
            }
          }),
          button("导入备份", () => input.current.click()),
          element("input", {
            ref: input,
            type: "file",
            accept: ".json,application/json",
            hidden: true,
            "aria-label": "选择数独备份文件",
            onChange: chooseFile,
          }),
        ],
      }),
      pending && group("div", {
        className: "flex flex-col gap-2",
        children: [
          element("p", {
            style: {color: colors.text},
            className: "text-xs break-all",
            children: `${pending.fileName} · ${pending.time}`,
          }),
          element("p", {
            style: {color: colors.textMuted},
            className: "text-xs",
            children: "恢复后，本机棋局、统计、每日记录和设置会换成此备份。",
          }),
          group("div", {
            className: "flex flex-wrap gap-2",
            children: [
              button("确认替换本机记录", confirmRestore, true),
              button("取消", () => setPending(null)),
            ],
          }),
        ],
      }),
      notice && element("p", {style: {color: colors.textMuted}, className: "text-xs", role: "status", children: notice}),
    ],
  });
}
