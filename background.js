/* No cookies, credentials, remote scripts, or network requests. */
'use strict';
function fromFlow(value) {
  try { return new URL(value.replace(/^blob:/, '')).hostname === 'flow.google.com'; }
  catch { return false; }
}
function candidate(item, job) {
  return Date.parse(item.startTime) >= job.started && !job.baseline.includes(item.id) &&
    (fromFlow(item.url || '') || fromFlow(item.referrer || '')) &&
    (!item.mime || item.mime.startsWith('image/') || item.mime === 'application/octet-stream');
}
let serial = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!sender.tab || !fromFlow(sender.url || '') || message?.scope !== 'flow2k') return;
  serial = serial.catch(() => {}).then(async () => {
    const { job } = await chrome.storage.session.get('job');
    if (message.type === 'arm') {
      if (job) throw new Error('仍有下载监控未结束，请先检查下载记录，再点击“解除待核对”。');
      const baseline = (await chrome.downloads.search({limit:100, orderBy:['-startTime']})).map(x => x.id);
      const next = {tabId:sender.tab.id, token:message.token, started:Date.now(), baseline};
      await chrome.storage.session.set({job:next});
      return {ok:true};
    }
    if (message.type === 'reset') {
      if (job && job.tabId !== sender.tab.id) throw new Error('请到启动任务的 Flow 标签页解除监控。');
      await chrome.storage.session.remove('job');
      return {ok:true};
    }
    if (!job || job.tabId !== sender.tab.id || job.token !== message.token) throw new Error('下载监控已失效，请停止并核对文件。');
    if (message.type === 'release') {
      await chrome.storage.session.remove('job');
      return {ok:true};
    }
    if (message.type === 'poll') {
      const items = (await chrome.downloads.search({startedAfter:new Date(job.started - 1000).toISOString(), limit:100}))
        .filter(x => candidate(x, job));
      if (items.length > 1) throw new Error('同时检测到多项 Flow 下载，无法对应图片，已停止。');
      if (!items.length) return {ok:true, state:'waiting'};
      const item = items[0];
      if (item.state === 'interrupted') throw new Error('下载中断：' + (item.error || '请查看 Edge 下载记录'));
      if (item.state === 'complete' && item.fileSize === 0) throw new Error('下载结果为空文件，已停止。');
      return {ok:true, state:item.state, filename:item.filename, bytes:item.fileSize};
    }
    throw new Error('未知操作');
  }).then(reply, error => reply({ok:false, error:error.message}));
  return true;
});
