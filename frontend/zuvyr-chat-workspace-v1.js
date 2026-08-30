(function () {
  'use strict';

  const ICON = './zuvyr-app-icon-20260827.png?v=1';

  function getZuvyrAccountName() {
    try {
      if (typeof getRoxAccountDisplayName === 'function') {
        const accountName = String(
          getRoxAccountDisplayName() || ''
        ).trim();

        if (
          accountName &&
          accountName !== 'Rox user' &&
          accountName !== '–'
        ) {
          return accountName;
        }
      }
    } catch (_) {
      // The profile may still be loading.
    }

    const candidates = [
      document.getElementById('topbarUserName'),
      document.getElementById('sidebarProfileName')
    ];

    for (const candidate of candidates) {
      const value = candidate
        ? String(candidate.textContent || '').trim()
        : '';

      if (
        value &&
        value !== '–' &&
        value !== 'Loading...'
      ) {
        return value;
      }
    }

    return '';
  }

  function enhanceWelcome(messages) {
    const messageNodes = messages.querySelectorAll(':scope > .msg');
    const first = messageNodes[0];
    const isEmpty =
      messageNodes.length === 1 &&
      first &&
      first.classList.contains('bot');

    messages.classList.toggle(
      'zuvyr-chat-empty',
      Boolean(isEmpty)
    );

    if (!isEmpty) return;

    if (first.dataset.zuvyrWelcome !== '1') {
      first.dataset.zuvyrWelcome = '1';
      first.classList.add('zuvyr-chat-welcome');
      first.removeAttribute('data-i18n');
      first.replaceChildren();

      const title = document.createElement('strong');
      title.className = 'zuvyr-chat-welcome-title';

      const subtitle = document.createElement('span');
      subtitle.className = 'zuvyr-chat-welcome-subtitle';
      subtitle.textContent =
        'Ask questions, create, plan, or build anything.';

      first.append(title, subtitle);
    }

    const title = first.querySelector(
      '.zuvyr-chat-welcome-title'
    );
    const accountName = getZuvyrAccountName();

    if (title) {
      title.textContent = accountName
        ? 'How can ZUVYR help, ' + accountName + '?'
        : 'How can ZUVYR help?';
    }
  }

  function setupZuvyrChatWorkspace() {
    const feature = document.getElementById('feature-chat');
    if (!feature) return;

    const screen = feature.classList.contains('feature-screen')
      ? feature
      : feature.querySelector(':scope > .feature-screen');

    if (!screen || screen.dataset.zuvyrChatWorkspace === '1') return;

    const topbar = screen.querySelector(
      ':scope > .feature-topbar, :scope > .modal-topbar'
    );
    const messages = screen.querySelector(':scope > #msgs-chat');
    const composer = screen.querySelector(':scope > .chat-input-row');

    if (!topbar || !messages || !composer) return;

    screen.dataset.zuvyrChatWorkspace = '1';
    screen.classList.add('zuvyr-chat-workspace');

    const sidebar = document.createElement('aside');
    sidebar.className = 'zuvyr-chat-sidebar';
    sidebar.setAttribute('aria-label', 'ZUVYR Chat navigation');

    const brand = document.createElement('div');
    brand.className = 'zuvyr-chat-brand';
    brand.innerHTML =
      '<img src="' + ICON + '" alt="">' +
      '<span>ZUVYR</span>';

    const primary = document.createElement('div');
    primary.className = 'zuvyr-chat-primary';

    const newChat = topbar.querySelector('.rox-new-chat');
    if (newChat) {
      newChat.classList.add('zuvyr-sidebar-new-chat');
      primary.append(newChat);
    }

    const identity = document.createElement('div');
    identity.className = 'zuvyr-chat-identity';
    identity.innerHTML =
      '<span class="zuvyr-chat-eyebrow">AI WORKSPACE</span>' +
      '<strong>Think. Create. Build.</strong>' +
      '<p>Your conversations and ideas, together in ZUVYR.</p>';

    const capabilities = document.createElement('div');
    capabilities.className = 'zuvyr-chat-capabilities';
    capabilities.innerHTML =
      '<span><i></i>Ask anything</span>' +
      '<span><i></i>Plan projects</span>' +
      '<span><i></i>Create with AI</span>';

    const sidebarBottom = document.createElement('div');
    sidebarBottom.className = 'zuvyr-chat-sidebar-bottom';

    const back = topbar.querySelector('[data-close]');
    if (back) {
      back.classList.add('zuvyr-chat-back');
      back.innerHTML =
        '<span aria-hidden="true">&larr;</span>' +
        '<b>Back to ZUVYR</b>';
      sidebarBottom.append(back);
    }

    const main = document.createElement('main');
    main.className = 'zuvyr-chat-main';

    const activeTitle = document.createElement('div');
    activeTitle.className = 'zuvyr-chat-active-title';
    activeTitle.hidden = true;
    activeTitle.setAttribute('aria-live', 'polite');

    const updateActiveTitle = function (event) {
      const detail = event && event.detail ? event.detail : {};
      if (String(detail.feature || '') !== 'chat') return;
      const nextTitle = String(detail.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      activeTitle.textContent = nextTitle;
      activeTitle.hidden = !nextTitle;
    };

    window.addEventListener('rox:conversation-title', updateActiveTitle);

    const icon = topbar.querySelector('.fic');
    if (icon) {
      icon.innerHTML = '<img src="' + ICON + '" alt="">';
    }

    const title = topbar.querySelector('.meta .t');
    if (title) {
      title.removeAttribute('data-i18n');
      title.textContent = 'ZUVYR Chat';
    }

    const status = topbar.querySelector('.meta .s');
    if (status) {
      status.removeAttribute('data-i18n');
      status.textContent = 'Ready';
    }

    sidebar.append(
      brand,
      primary,
      identity,
      capabilities,
      sidebarBottom
    );
    topbar.remove();
    main.append(activeTitle, messages, composer);
    screen.append(sidebar, main);

    enhanceWelcome(messages);

    const observer = new MutationObserver(function () {
      enhanceWelcome(messages);
    });
    observer.observe(messages, { childList: true });

    const accountSources = [
      document.getElementById('heroGreeting'),
      document.getElementById('topbarUserName'),
      document.getElementById('sidebarProfileName')
    ].filter(Boolean);

    if (accountSources.length) {
      const accountObserver = new MutationObserver(function () {
        enhanceWelcome(messages);
      });

      accountSources.forEach(function (source) {
        accountObserver.observe(source, {
          childList: true,
          characterData: true,
          subtree: true
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      setupZuvyrChatWorkspace,
      { once: true }
    );
  } else {
    setupZuvyrChatWorkspace();
  }
})();
/* ZUVYR CHAT VOICE UI V1 */
(() => {
  const micIcon = `
    <svg class="zuvyr-voice-icon" viewBox="0 0 24 24"
      aria-hidden="true" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3"></rect>
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0"></path>
      <path d="M12 17.5V21"></path>
      <path d="M9 21h6"></path>
    </svg>`;

  const stopIcon = `
    <svg class="zuvyr-voice-icon" viewBox="0 0 24 24"
      aria-hidden="true" fill="currentColor">
      <rect x="7" y="7" width="10" height="10" rx="2"></rect>
    </svg>`;

  const enhanceVoice = () => {
    document
      .querySelectorAll(
        '#feature-chat button[data-voice-input="chat"]'
      )
      .forEach((button) => {
        if (button.dataset.zuvyrVoiceUi === '1') return;

        const row = button.closest('.chat-input-row');
        const input = row?.querySelector(
          '[data-feature="chat"]'
        );

        if (!row || !input) return;

        button.dataset.zuvyrVoiceUi = '1';
        button.innerHTML = micIcon;
        button.title = 'Dictate — Ctrl+Shift+D';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'zuvyr-voice-cancel';
        cancel.setAttribute('aria-label', 'Cancel dictation');
        cancel.title = 'Cancel dictation';
        cancel.innerHTML = `
          <svg viewBox="0 0 24 24" width="21" height="21"
            aria-hidden="true" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round">
            <path d="M6 6l12 12M18 6L6 18"></path>
          </svg>`;

        const waveform = document.createElement('div');
        waveform.className = 'zuvyr-voice-waveform';
        waveform.setAttribute('role', 'status');
        waveform.setAttribute('aria-label', 'Listening');

        for (let index = 0; index < 24; index++) {
          const bar = document.createElement('span');
          bar.style.setProperty('--i', String(index));
          waveform.appendChild(bar);
        }

        row.insertBefore(cancel, input);
        row.insertBefore(waveform, input);

        button.addEventListener(
          'click',
          () => {
            if (!button.classList.contains('is-listening')) {
              button.dataset.zuvyrVoiceBefore = input.value;
              delete row.dataset.zuvyrVoiceCancel;
            }
          },
          true
        );

        cancel.addEventListener('click', () => {
          row.dataset.zuvyrVoiceCancel = '1';

          if (button.classList.contains('is-listening')) {
            button.click();
          } else {
            input.value =
              button.dataset.zuvyrVoiceBefore || '';
            input.dispatchEvent(
              new Event('input', { bubbles: true })
            );
          }
        });

        const syncVoiceState = () => {
          const listening =
            button.classList.contains('is-listening');

          row.classList.toggle(
            'zuvyr-voice-listening',
            listening
          );

          button.innerHTML = listening ? stopIcon : micIcon;
          button.title = listening
            ? 'Stop dictation'
            : 'Dictate — Ctrl+Shift+D';

          if (
            !listening &&
            row.dataset.zuvyrVoiceCancel === '1'
          ) {
            input.value =
              button.dataset.zuvyrVoiceBefore || '';

            input.dispatchEvent(
              new Event('input', { bubbles: true })
            );

            delete row.dataset.zuvyrVoiceCancel;
            input.focus();
          }
        };

        new MutationObserver(syncVoiceState).observe(
          button,
          {
            attributes: true,
            attributeFilter: ['class']
          }
        );

        syncVoiceState();
      });
  };

  document.addEventListener('keydown', (event) => {
    if (
      event.ctrlKey &&
      event.shiftKey &&
      event.code === 'KeyD'
    ) {
      const button = document.querySelector(
        '#feature-chat button[data-voice-input="chat"]'
      );

      if (
        button &&
        button.offsetParent !== null
      ) {
        event.preventDefault();
        button.click();
      }
    }
  });

  enhanceVoice();

  new MutationObserver(enhanceVoice).observe(
    document.documentElement,
    {
      childList: true,
      subtree: true
    }
  );
})();
/* ZUVYR REAL AUDIO WAVEFORM V2 */
(() => {
  const sessions = new WeakMap();

  const stopVisualizer = (button) => {
    const session = sessions.get(button);
    if (!session) return;

    session.wanted = false;

    if (session.frame) {
      cancelAnimationFrame(session.frame);
    }

    if (session.stream) {
      session.stream
        .getTracks()
        .forEach((track) => track.stop());
    }

    if (
      session.context &&
      session.context.state !== 'closed'
    ) {
      session.context.close().catch(() => {});
    }

    if (session.waveform) {
      session.waveform.classList.remove(
        'zuvyr-waveform-live'
      );

      session.waveform
        .querySelectorAll('span')
        .forEach((bar) => {
          bar.style.removeProperty('height');
          bar.style.removeProperty('opacity');
        });
    }

    sessions.delete(button);
  };

  const startVisualizer = async (
    button,
    row,
    waveform
  ) => {
    if (
      sessions.has(button) ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      return;
    }

    const AudioEngine =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioEngine) return;

    const context = new AudioEngine();
    context.resume().catch(() => {});

    const session = {
      wanted: true,
      context,
      stream: null,
      frame: 0,
      waveform
    };

    sessions.set(button, session);

    try {
      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

      session.stream = stream;

      if (
        !session.wanted ||
        !button.classList.contains('is-listening')
      ) {
        stopVisualizer(button);
        return;
      }

      const source =
        context.createMediaStreamSource(stream);

      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.72;

      source.connect(analyser);

      const samples =
        new Uint8Array(analyser.fftSize);

      const bars = Array.from(
        waveform.querySelectorAll('span')
      );

      const smoothed =
        new Float32Array(bars.length);

      waveform.classList.add(
        'zuvyr-waveform-live'
      );

      const draw = () => {
        if (
          !session.wanted ||
          !button.classList.contains('is-listening')
        ) {
          stopVisualizer(button);
          return;
        }

        analyser.getByteTimeDomainData(samples);

        const segmentSize = Math.max(
          1,
          Math.floor(samples.length / bars.length)
        );

        bars.forEach((bar, index) => {
          const start = index * segmentSize;
          const end = Math.min(
            samples.length,
            start + segmentSize
          );

          let energy = 0;

          for (
            let sampleIndex = start;
            sampleIndex < end;
            sampleIndex++
          ) {
            const value =
              (samples[sampleIndex] - 128) / 128;

            energy += value * value;
          }

          const rms = Math.sqrt(
            energy / Math.max(1, end - start)
          );

          const level = Math.min(1, rms * 7.5);

          smoothed[index] =
            smoothed[index] * 0.58 +
            level * 0.42;

          const height =
            3 + Math.pow(smoothed[index], 0.72) * 34;

          bar.style.height = `${height.toFixed(1)}px`;
          bar.style.opacity = String(
            Math.min(
              1,
              0.34 + smoothed[index] * 1.25
            )
          );
        });

        session.frame =
          requestAnimationFrame(draw);
      };

      draw();
    } catch (error) {
      console.warn(
        'ZUVYR live waveform unavailable:',
        error
      );

      stopVisualizer(button);
    }
  };

  const enhanceRealWaveform = () => {
    document
      .querySelectorAll(
        '#feature-chat button[data-voice-input="chat"]'
      )
      .forEach((button) => {
        if (
          button.dataset.zuvyrRealWaveform === '1'
        ) {
          return;
        }

        const row = button.closest('.chat-input-row');
        const waveform = row?.querySelector(
          '.zuvyr-voice-waveform'
        );

        if (!row || !waveform) return;

        button.dataset.zuvyrRealWaveform = '1';

        while (waveform.children.length < 64) {
          const bar = document.createElement('span');

          bar.style.setProperty(
            '--i',
            String(waveform.children.length)
          );

          waveform.appendChild(bar);
        }

        button.addEventListener(
          'click',
          () => {
            if (
              !button.classList.contains(
                'is-listening'
              )
            ) {
              void startVisualizer(
                button,
                row,
                waveform
              );
            }
          },
          true
        );

        const sync = () => {
          if (
            !button.classList.contains(
              'is-listening'
            )
          ) {
            stopVisualizer(button);
          }
        };

        new MutationObserver(sync).observe(
          button,
          {
            attributes: true,
            attributeFilter: ['class']
          }
        );
      });
  };

  enhanceRealWaveform();

  new MutationObserver(
    enhanceRealWaveform
  ).observe(
    document.documentElement,
    {
      childList: true,
      subtree: true
    }
  );
})();
/* ZUVYR DURABLE MULTI-ATTACHMENTS V1 */
(() => {
  const MAX_ATTACHMENTS_PER_TURN = 20;
  const MAX_ATTACHMENT_BYTES = 600 * 1024 * 1024;
  const READY_POLL_MS = 2500;
  const READY_TIMEOUT_MS = 20 * 60 * 1000;
  const BLOCKED_EXTENSIONS = new Set([
    'exe','dll','msi','com','scr','pif','bat','cmd','ps1','psm1',
    'vbs','vbe','wsf','wsh','hta','cpl','jar','apk','app','dmg',
    'pkg','deb','rpm','iso','img','reg','lnk','scf','gadget'
  ]);

  const plusIcon = `<svg class="zuvyr-attach-plus" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>`;
  const paperclipIcon = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"></path></svg>`;
  const cameraIcon = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h3l2-3h6l2 3h3v13H4z"></path><circle cx="12" cy="13" r="4"></circle></svg>`;
  const fileIcon = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 2h8l4 4v16H6z"></path><path d="M14 2v5h5"></path></svg>`;

  const formatBytes = bytes => {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1048576) return `${Math.round(value / 1024)} KB`;
    if (value < 1073741824) return `${(value / 1048576).toFixed(1)} MB`;
    return `${(value / 1073741824).toFixed(2)} GB`;
  };

  const extensionOf = name => {
    const value = String(name || '').trim().toLowerCase();
    const index = value.lastIndexOf('.');
    return index >= 0 ? value.slice(index + 1) : '';
  };

  const humanError = error => {
    const code = String(error?.code || error?.message || '');
    if (code.includes('too_many')) return 'You can attach up to 20 files per message.';
    if (code.includes('too_large')) return 'Each file must be 600 MB or smaller.';
    if (code.includes('blocked') || code.includes('dangerous')) return 'This file type is blocked for security.';
    if (code.includes('insufficient')) return 'There are not enough credits to process these files.';
    if (code.includes('timeout')) return 'File processing took too long. You can try again.';
    return error?.message && !code.includes('_')
      ? error.message
      : 'ZUVYR could not process the selected files.';
  };

  const localId = () => (
    globalThis.crypto?.randomUUID?.() ||
    `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  const createPreview = file => (
    String(file.type || '').startsWith('image/')
      ? URL.createObjectURL(file)
      : ''
  );

  const validateFile = file => {
    if (!(file instanceof File) || file.size < 1) {
      throw new Error('invalid_attachment_size');
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error('attachment_too_large');
    }
    if (BLOCKED_EXTENSIONS.has(extensionOf(file.name))) {
      throw new Error('blocked_attachment_type');
    }
  };

  const entryFor = file => {
    validateFile(file);
    return {
      localId: localId(),
      file,
      name: String(file.name || 'attachment').slice(-180),
      size: file.size,
      mimeType: String(file.type || 'application/octet-stream').toLowerCase(),
      previewUrl: createPreview(file),
      status: 'ready',
      statusText: 'Ready',
      assetId: null,
      path: null,
      source: null
    };
  };

  const entriesFor = row => (
    Array.isArray(row?._zuvyrAttachments)
      ? row._zuvyrAttachments
      : []
  );

  const syncCompatibility = row => {
    const entries = entriesFor(row);
    row._zuvyrAttachment = entries[0] || null;
    if (entries.length) row.setAttribute('data-zuvyr-attachment-active','1');
    else row.removeAttribute('data-zuvyr-attachment-active');
  };

  const setEntryStatus = (entry,status,text) => {
    entry.status = status;
    entry.statusText = text;
    document.querySelectorAll(`[data-zuvyr-local-id="${CSS.escape(entry.localId)}"] .zuvyr-attachment-status`)
      .forEach(node => {
        node.textContent = text;
        node.dataset.status = status;
      });
  };

  const renderSelection = row => {
    const list = row.querySelector('.zuvyr-attachment-list');
    if (!list) return;
    list.replaceChildren();

    entriesFor(row).forEach(entry => {
      const item = document.createElement('div');
      item.className = 'zuvyr-attachment-item';
      item.dataset.zuvyrLocalId = entry.localId;

      const visual = entry.previewUrl
        ? document.createElement('img')
        : document.createElement('span');
      visual.className = 'zuvyr-attachment-visual';
      if (entry.previewUrl) {
        visual.src = entry.previewUrl;
        visual.alt = '';
      } else {
        visual.innerHTML = fileIcon;
      }

      const copy = document.createElement('span');
      copy.className = 'zuvyr-attachment-copy';
      const name = document.createElement('span');
      name.className = 'zuvyr-attachment-name';
      name.textContent = entry.name;
      const meta = document.createElement('span');
      meta.className = 'zuvyr-attachment-meta';
      meta.textContent = formatBytes(entry.size);
      const status = document.createElement('span');
      status.className = 'zuvyr-attachment-status';
      status.dataset.status = entry.status;
      status.textContent = entry.statusText;
      copy.append(name,meta,status);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'zuvyr-attachment-remove';
      remove.setAttribute('aria-label',`Remove ${entry.name}`);
      remove.textContent = 'Ã—';
      remove.disabled = Boolean(window.__zuvyrAttachmentUploadActive);
      remove.addEventListener('click',() => {
        if (window.__zuvyrAttachmentUploadActive) return;
        row._zuvyrAttachments = entriesFor(row)
          .filter(candidate => candidate.localId !== entry.localId);
        syncCompatibility(row);
        renderSelection(row);
        row.querySelector('[data-feature="chat"]')?.focus();
      });

      item.append(visual,copy,remove);
      list.appendChild(item);
    });

    list.hidden = entriesFor(row).length === 0;
    syncCompatibility(row);
  };

  const addFiles = (row,files) => {
    const current = entriesFor(row);
    const incoming = Array.from(files || []);
    if (current.length + incoming.length > MAX_ATTACHMENTS_PER_TURN) {
      throw new Error('too_many_attachments');
    }

    const known = new Set(current.map(entry => (
      `${entry.file.name}:${entry.file.size}:${entry.file.lastModified}`
    )));

    for (const file of incoming) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (known.has(key)) continue;
      current.push(entryFor(file));
      known.add(key);
    }

    row._zuvyrAttachments = current;
    renderSelection(row);
  };

  const clearAttachments = row => {
    row._zuvyrAttachments = [];
    syncCompatibility(row);
    renderSelection(row);
  };

  const captureScreenshotFile = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('screenshot_unsupported');
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video:{frameRate:1},
      audio:false
    });
    try {
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise(resolve => setTimeout(resolve,180));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1,video.videoWidth);
      canvas.height = Math.max(1,video.videoHeight);
      canvas.getContext('2d').drawImage(video,0,0);
      const blob = await new Promise((resolve,reject) => {
        canvas.toBlob(value => value ? resolve(value) : reject(new Error('screenshot_failed')),'image/jpeg',.9);
      });
      return new File(
        [blob],
        `ZUVYR-screenshot-${Date.now()}.jpg`,
        {type:'image/jpeg',lastModified:Date.now()}
      );
    } finally {
      stream.getTracks().forEach(track => track.stop());
    }
  };

  const renderSentAttachments = (entries,text) => {
    const layout = document.createElement('div');
    layout.className = 'zuvyr-sent-attachments-message';
    const files = document.createElement('div');
    files.className = 'zuvyr-sent-attachment-files';

    entries.forEach(entry => {
      const card = document.createElement('div');
      card.className = 'zuvyr-sent-attachment';
      card.dataset.zuvyrLocalId = entry.localId;
      const visual = entry.previewUrl
        ? document.createElement('img')
        : document.createElement('span');
      visual.className = 'zuvyr-sent-attachment-visual';
      if (entry.previewUrl) {
        visual.src = entry.previewUrl;
        visual.alt = entry.name;
      } else {
        visual.innerHTML = fileIcon;
      }
      const copy = document.createElement('span');
      copy.className = 'zuvyr-sent-attachment-copy';
      const name = document.createElement('strong');
      name.textContent = entry.name;
      const meta = document.createElement('span');
      meta.textContent = formatBytes(entry.size);
      const status = document.createElement('span');
      status.className = 'zuvyr-attachment-status';
      status.dataset.status = entry.status;
      status.textContent = entry.statusText;
      copy.append(name,meta,status);
      card.append(visual,copy);
      files.appendChild(card);
    });

    layout.appendChild(files);
    const captionText = String(text || '').trim();
    if (captionText && captionText !== 'Analyze the attached files.') {
      const caption = document.createElement('div');
      caption.className = 'zuvyr-sent-attachment-caption';
      caption.textContent = captionText;
      layout.appendChild(caption);
    }
    return layout;
  };

  const updateBalance = data => {
    if (typeof data?.newBalance !== 'number') return;
    if (typeof profile === 'undefined' || !profile) return;
    if (typeof renderProUsage !== 'function') return;
    const total = profile.credits_total || 500;
    renderProUsage(total - data.newBalance,total,data.newBalance);
  };

  const requestJson = async (path,options) => {
    const response = await authFetch(path,options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || data.code || `HTTP ${response.status}`);
      error.code = data.code || 'attachment_request_failed';
      error.status = response.status;
      throw error;
    }
    return data;
  };

  const TUS_UPLOAD_THRESHOLD_BYTES = 6 * 1024 * 1024;
  const TUS_CHUNK_BYTES = 6 * 1024 * 1024;

  const resumableStorageEndpoint = () => {
    const projectUrl = new URL(CONFIG.SUPABASE_URL);
    const projectId = projectUrl.hostname.split('.')[0];
    if (!/^[a-z0-9-]+$/i.test(projectId)) {
      throw new Error('attachment_storage_project_invalid');
    }
    return `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`;
  };

  const uploadLargeResumable = entry => new Promise((resolve,reject) => {
    if (!window.tus || typeof window.tus.Upload !== 'function') {
      reject(new Error('attachment_resumable_upload_unavailable'));
      return;
    }

    const upload = new window.tus.Upload(entry.file,{
      endpoint:resumableStorageEndpoint(),
      retryDelays:[0,3000,5000,10000,20000],
      headers:{'x-signature':entry.uploadToken},
      uploadDataDuringCreation:true,
      removeFingerprintOnSuccess:true,
      chunkSize:TUS_CHUNK_BYTES,
      metadata:{
        bucketName:entry.bucket,
        objectName:entry.path,
        contentType:entry.mimeType,
        cacheControl:'3600'
      },
      onError:error=>reject(error),
      onProgress:(uploaded,total)=>{
        const percent = total > 0 ? Math.floor((uploaded / total) * 100) : 0;
        setEntryStatus(entry,'uploading',`Uploading ${percent}%`);
      },
      onSuccess:()=>resolve()
    });

    upload.findPreviousUploads()
      .then(previous=>{
        if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch(reject);
  });

  const uploadOne = async (conversationId,entry) => {
    if (entry.assetId) return entry.assetId;
    setEntryStatus(entry,'preparing','Preparing');

    if (!entry.path) {
      const signed = await requestJson(
        `/api/conversations/${encodeURIComponent(conversationId)}/assets/upload-url`,
        {
          method:'POST',
          body:JSON.stringify({
            fileName:entry.name,
            mimeType:entry.mimeType,
            sizeBytes:entry.size
          })
        }
      );
      entry.path = signed?.upload?.path;
      entry.uploadToken = signed?.upload?.token;
      entry.bucket = signed?.upload?.bucket;
      if (!entry.path || !entry.uploadToken || !entry.bucket) {
        throw new Error('attachment_upload_contract_invalid');
      }

      setEntryStatus(entry,'uploading','Uploading');
      if (entry.size > TUS_UPLOAD_THRESHOLD_BYTES) {
        await uploadLargeResumable(entry);
      } else {
        const { error } = await supa.storage
          .from(entry.bucket)
          .uploadToSignedUrl(
            entry.path,
            entry.uploadToken,
            entry.file,
            {contentType:entry.mimeType,upsert:false}
          );
        if (error) throw error;
      }
    }

    setEntryStatus(entry,'processing','Processing');
    const completed = await requestJson(
      `/api/conversations/${encodeURIComponent(conversationId)}/assets/complete`,
      {
        method:'POST',
        body:JSON.stringify({
          fileName:entry.name,
          mimeType:entry.mimeType,
          sizeBytes:entry.size,
          path:entry.path
        })
      }
    );
    updateBalance(completed);
    entry.assetId = String(completed?.asset?.id || '');
    entry.queued = completed?.status === 'queued';
    if (!entry.assetId) throw new Error('attachment_asset_missing');
    if (!entry.queued) setEntryStatus(entry,'ready','Ready');
    return entry.assetId;
  };

  const fetchReadyAssets = async conversationId => {
    const data = await requestJson(
      `/api/conversations/${encodeURIComponent(conversationId)}/assets?limit=100`,
      {method:'GET'}
    );
    return Array.isArray(data.items) ? data.items : [];
  };

  const waitForReadyAssets = async (conversationId,entries) => {
    const wanted = new Set(entries.map(entry => String(entry.assetId)));
    const ready = new Map();
    const deadline = Date.now() + READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const assets = await fetchReadyAssets(conversationId);
      assets.forEach(asset => {
        const id = String(asset?.id || '');
        if (wanted.has(id)) ready.set(id,asset);
      });

      entries.forEach(entry => {
        const source = ready.get(String(entry.assetId));
        if (source) {
          entry.source = source;
          setEntryStatus(entry,'ready','Ready');
        } else {
          setEntryStatus(entry,'processing','Processing');
        }
      });

      if (ready.size === wanted.size) return ready;
      await new Promise(resolve => setTimeout(resolve,READY_POLL_MS));
    }

    throw new Error('attachment_processing_timeout');
  };

  const patchAppendMsg = () => {
    if (typeof window.appendMsg !== 'function' || window.appendMsg.__zuvyrDurableAttachmentsV1) return;
    const original = window.appendMsg;
    const wrapped = function(msgBox,cls,content,isNode,meta = {}) {
      const classes = String(cls || '').split(/\s+/);
      const isUser = classes.includes('user');
      const isBot = classes.includes('bot');

      if (!isNode && isUser && msgBox?.id === 'msgs-chat') {
        const row = document.querySelector('#feature-chat .chat-input-row[data-zuvyr-attachment-active="1"]');
        const pending = Array.isArray(window.__zuvyrSendingAttachmentEntries)
          ? window.__zuvyrSendingAttachmentEntries
          : [];
        const entries = pending.length
          ? pending.slice()
          : entriesFor(row).slice();
        if (entries.length) {
          return original.call(
            this,msgBox,cls,
            renderSentAttachments(entries,content),
            true,meta
          );
        }
      }

      if (isBot && meta && Array.isArray(meta.sources)) {
        const map = window.__zuvyrAttachmentSourceMap;
        if (map instanceof Map) {
          meta = {
            ...meta,
            sources:meta.sources.map(source => {
              const stored = map.get(String(source?.id || ''));
              return stored
                ? {
                    ...source,
                    url:stored.access_url || source.url || null,
                    title:source.title || source.name || stored.original_name
                  }
                : source;
            })
          };
        }
      }

      return original.call(this,msgBox,cls,content,isNode,meta);
    };
    wrapped.__zuvyrDurableAttachmentsV1 = true;
    wrapped.__zuvyrOriginal = original;
    window.appendMsg = wrapped;
  };

  const patchSendChat = () => {
    if (typeof window.sendChat !== 'function' || window.sendChat.__zuvyrDurableAttachmentsV1) return;
    const original = window.sendChat;
    const wrapped = async function(feature,text,msgBox,userMessage) {
      if (feature !== 'chat') {
        return original.call(this,feature,text,msgBox,userMessage);
      }

      const row = document.querySelector('#feature-chat .chat-input-row[data-zuvyr-attachment-active="1"]');
      const entries = entriesFor(row).slice();
      if (!entries.length) {
        return original.call(this,feature,text,msgBox,userMessage);
      }
      if (window.__zuvyrAttachmentUploadActive) return;

      const outgoingText = String(text || '').trim() || 'Analyze the attached files.';
      window.__zuvyrAttachmentUploadActive = true;
      renderSelection(row);

      try {
        if (typeof isRoxDemoSession === 'function' && isRoxDemoSession()) {
          throw new Error('Attachments require a signed-in account.');
        }
        const conversationId = await ensureRoxConversation(feature,outgoingText);
        for (const entry of entries) {
          await uploadOne(conversationId,entry);
        }
        const ready = await waitForReadyAssets(conversationId,entries);
        window.__zuvyrChatAttachmentIds = entries.map(entry => entry.assetId);
        window.__zuvyrAttachmentSourceMap = ready;
        window.__zuvyrSendingAttachmentEntries = entries;
        clearAttachments(row);
        const composer = row?.querySelector('[data-feature="chat"]');
        if (composer) composer.style.height = '48px';
        return await original.call(this,feature,outgoingText,msgBox,userMessage);
      } catch (error) {
        entries.forEach(entry => {
          if (entry.status !== 'ready') setEntryStatus(entry,'failed','Failed');
        });
        if (typeof appendMsg === 'function') {
          appendMsg(msgBox,'error',humanError(error));
        }
        return undefined;
      } finally {
        window.__zuvyrChatAttachmentIds = [];
        window.__zuvyrAttachmentSourceMap = null;
        window.__zuvyrSendingAttachmentEntries = null;
        window.__zuvyrAttachmentUploadActive = false;
        renderSelection(row);
      }
    };
    wrapped.__zuvyrDurableAttachmentsV1 = true;
    wrapped.__zuvyrOriginal = original;
    window.sendChat = wrapped;
  };

  const enhance = () => {
    patchAppendMsg();
    patchSendChat();
    document.querySelectorAll('#feature-chat .chat-input-row').forEach(row => {
      if (row.dataset.zuvyrAttachMenu === '4') return;
      const input = row.querySelector('[data-feature="chat"]');
      if (!input) return;
      row.dataset.zuvyrAttachMenu = '4';
      row._zuvyrAttachments = [];

      if (input.tagName === 'TEXTAREA' && input.dataset.zuvyrAutosize !== '1') {
        input.dataset.zuvyrAutosize = '1';
        const resizeComposer = () => {
          input.style.height = '48px';
          input.style.height = Math.min(input.scrollHeight,160) + 'px';
        };
        input.addEventListener('input',resizeComposer);
        resizeComposer();
      }

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'zuvyr-attach-button';
      trigger.setAttribute('aria-label','Add files or photos');
      trigger.setAttribute('aria-expanded','false');
      trigger.title = 'Attach';
      trigger.innerHTML = plusIcon;

      const picker = document.createElement('input');
      picker.type = 'file';
      picker.hidden = true;
      picker.multiple = true;

      const menu = document.createElement('div');
      menu.className = 'zuvyr-attach-menu';
      menu.hidden = true;
      menu.innerHTML = `<button type="button" class="zuvyr-attach-action" data-action="files"><span class="zuvyr-attach-action-icon">${paperclipIcon}</span><span><span class="zuvyr-attach-action-title">Add files or photos</span><span class="zuvyr-attach-action-subtitle">Up to 20 files, 600 MB each</span></span></button><button type="button" class="zuvyr-attach-action" data-action="screenshot"><span class="zuvyr-attach-action-icon">${cameraIcon}</span><span><span class="zuvyr-attach-action-title">Take a screenshot</span><span class="zuvyr-attach-action-subtitle">Choose a screen, window, or tab</span></span></button>`;

      const list = document.createElement('div');
      list.className = 'zuvyr-attachment-list';
      list.hidden = true;
      row.insertBefore(trigger,input);
      row.append(picker,menu,list);

      const setOpen = open => {
        menu.hidden = !open;
        trigger.setAttribute('aria-expanded',open ? 'true' : 'false');
      };
      trigger.addEventListener('click',event => {
        event.preventDefault();
        event.stopPropagation();
        setOpen(menu.hidden);
      });
      menu.querySelector('[data-action="files"]').addEventListener('click',() => {
        picker.value = '';
        picker.click();
      });
      menu.querySelector('[data-action="screenshot"]').addEventListener('click',async () => {
        setOpen(false);
        try {
          addFiles(row,[await captureScreenshotFile()]);
          input.focus();
        } catch (error) {
          if (error?.name !== 'NotAllowedError') window.alert(humanError(error));
        }
      });
      picker.addEventListener('change',() => {
        try {
          addFiles(row,picker.files);
          setOpen(false);
          input.focus();
        } catch (error) {
          window.alert(humanError(error));
        }
      });
      document.addEventListener('pointerdown',event => {
        if (!menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target)) setOpen(false);
      });
      document.addEventListener('keydown',event => {
        if (event.key === 'Escape' && !menu.hidden) {
          setOpen(false);
          trigger.focus();
        }
      });
    });
  };

  enhance();
  new MutationObserver(enhance).observe(document.documentElement,{childList:true,subtree:true});
})();
/* ZUVYR CHATGPT ACTIONS V2 */
(function(){
  'use strict';

  const thumbUp='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v10H4a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h3Z"></path><path d="M7 20h9.3a2 2 0 0 0 1.9-1.4l2.2-7A2 2 0 0 0 18.5 9H14l.7-3.1A2.4 2.4 0 0 0 12.3 3L7 10Z"></path></svg>';
  const thumbDown='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14V4H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h3Z"></path><path d="M7 4h9.3a2 2 0 0 1 1.9 1.4l2.2 7a2 2 0 0 1-1.9 2.6H14l.7 3.1a2.4 2.4 0 0 1-2.4 2.9L7 14Z"></path></svg>';
  const rateIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10v9H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h3Z"></path><path d="M8 19h7.5a2 2 0 0 0 1.9-1.4l1.7-5.2A2 2 0 0 0 17.2 10H14l.5-2.4A2.1 2.1 0 0 0 12.4 5L8 10Z"></path><path d="M17 16v4"></path><path d="m15.5 18.5 1.5 1.5 1.5-1.5"></path></svg>';

  const language=()=>String(document.documentElement.lang||navigator.language||'en').toLowerCase();
  const labels=()=>{
    const lang=language();
    if(lang.startsWith('ar')) return {
      rate:'\u062a\u0642\u064a\u064a\u0645 \u0627\u0644\u062c\u0648\u0627\u0628',
      good:'\u062c\u0648\u0627\u0628 \u062c\u064a\u062f',
      bad:'\u062c\u0648\u0627\u0628 \u0633\u064a\u0626',
      sources:'\u0627\u0644\u0645\u0635\u0627\u062f\u0631',
      outputs:'\u0627\u0644\u0646\u062a\u0627\u0626\u062c',
      branching:'\u062c\u0627\u0631\u064a \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0641\u0631\u0639...',
      branchDone:'\u062a\u0645 \u0625\u0646\u0634\u0627\u0621 \u0645\u062d\u0627\u062f\u062b\u0629 \u062c\u062f\u064a\u062f\u0629.',
      branchFailed:'\u062a\u0639\u0630\u0631 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0641\u0631\u0639.'
    };
    return {
      rate:'Rate response',
      good:'Good response',
      bad:'Bad response',
      sources:'Sources',
      outputs:'Outputs',
      branching:'Creating branch...',
      branchDone:'New branched chat created.',
      branchFailed:'Could not create the branch.'
    };
  };

  const toast=text=>{
    document.querySelector('.zuvyr-action-toast')?.remove();
    const node=document.createElement('div');
    node.className='zuvyr-action-toast';
    node.textContent=text;
    document.body.appendChild(node);
    setTimeout(()=>node.remove(),3200);
  };

  const messageFor=actions=>
    actions.previousElementSibling?.classList.contains('msg')
      ? actions.previousElementSibling
      : null;

  const collectSources=message=>{
    const output=[];
    const add=(source,title)=>{
      if(source&&typeof source==='object'){
        const id=String(source.id||'').trim();
        const rawUrl=String(source.url||source.access_url||'').trim();
        let url='';
        if(rawUrl){
          try{
            const parsed=new URL(rawUrl,location.href);
            if(/^https?:$/i.test(parsed.protocol)) url=parsed.href;
          }catch(_){}
        }
        const key=id||url||`${source.name||source.title}:${source.mimeType||''}`;
        if(!key||output.some(item=>item.key===key)) return;
        output.push({
          key,
          id,
          url,
          title:String(source.title||source.name||title||'Attachment'),
          mimeType:String(source.mimeType||source.mime_type||''),
          assetType:String(source.assetType||source.asset_type||''),
          extractionStatus:String(source.extractionStatus||source.extraction_status||'')
        });
        return;
      }
      const raw=String(source||'').trim();
      if(!raw) return;
      try{
        const parsed=new URL(raw,location.href);
        if(!/^https?:$/i.test(parsed.protocol)) return;
        if(output.some(item=>item.url===parsed.href)) return;
        output.push({
          key:parsed.href,
          id:'',
          url:parsed.href,
          title:String(title||parsed.hostname||parsed.href),
          mimeType:'',assetType:'',extractionStatus:''
        });
      }catch(_){}
    };

    message?.querySelectorAll?.('a[href]').forEach(link=>add(link.href,link.textContent));
    const meta=Array.isArray(message?._zuvyrMeta?.sources)
      ? message._zuvyrMeta.sources
      : [];
    meta.forEach(source=>add(source,source?.title||source?.name));
    const text=String(message?.innerText||message?.textContent||'');
    (text.match(/https?:\/\/[^\s<>"')\]]+/g)||[]).forEach(url=>add(url));
    return output;
  };

  /* ZUVYR DURABLE OUTPUTS UI V1 */
  const collectOutputs=message=>{
    const output=[];
    const add=item=>{
      if(!item||typeof item!=='object') return;
      const rawUrl=String(item.url||item.access_url||'').trim();
      let url='';
      if(rawUrl){
        try{
          const parsed=new URL(rawUrl,location.href);
          if(/^https?:$/i.test(parsed.protocol)) url=parsed.href;
        }catch(_){}
      }
      if(!url) return;
      const type=String(item.type||item.assetType||item.asset_type||'file').toLowerCase();
      const key=String(item.id||'').trim()||url;
      if(output.some(entry=>entry.key===key)) return;
      output.push({
        key,
        url,
        type,
        title:String(item.title||item.name||(
          type==='image'?'Generated image':
          type==='video'?'Generated video':
          type==='audio'?'Generated audio':'Generated file'
        )),
        mimeType:String(item.mimeType||item.mime_type||'')
      });
    };

    const meta=Array.isArray(message?._zuvyrMeta?.outputs)
      ?message._zuvyrMeta.outputs
      :[];
    meta.forEach(add);
    message?.querySelectorAll?.('img[src],video[src],audio[src]').forEach(node=>{
      add({
        url:node.currentSrc||node.src,
        type:node.tagName.toLowerCase(),
        title:node.getAttribute('alt')||''
      });
    });
    return output;
  };

  const closeOutputs=()=>{
    document.querySelector('.zuvyr-outputs-backdrop')?.remove();
    document.querySelector('.zuvyr-outputs-panel')?.remove();
  };

  const openOutputs=outputs=>{
    closeOutputs();
    const backdrop=document.createElement('div');
    backdrop.className='zuvyr-outputs-backdrop';
    const panel=document.createElement('aside');
    panel.className='zuvyr-outputs-panel';
    const header=document.createElement('div');
    header.className='zuvyr-outputs-header';
    const title=document.createElement('span');
    title.textContent=labels().outputs;
    const close=document.createElement('button');
    close.type='button';
    close.className='zuvyr-outputs-close';
    close.setAttribute('aria-label','Close');
    close.textContent='\u00d7';
    header.append(title,close);
    panel.appendChild(header);

    outputs.forEach(item=>{
      const card=document.createElement('article');
      card.className='zuvyr-output-card';
      let preview=null;
      if(item.type==='image'){
        preview=document.createElement('img');
        preview.alt=item.title;
      }else if(item.type==='video'){
        preview=document.createElement('video');
        preview.controls=true;
        preview.playsInline=true;
      }else if(item.type==='audio'||item.type==='music'){
        preview=document.createElement('audio');
        preview.controls=true;
      }
      if(preview){
        preview.src=item.url;
        preview.className='zuvyr-output-preview';
        card.appendChild(preview);
      }
      const body=document.createElement('div');
      body.className='zuvyr-output-body';
      const name=document.createElement('strong');
      name.textContent=item.title;
      const detail=document.createElement('span');
      detail.textContent=item.mimeType||item.type;
      const actions=document.createElement('div');
      actions.className='zuvyr-output-actions';
      const open=document.createElement('a');
      open.href=item.url;
      open.target='_blank';
      open.rel='noopener noreferrer';
      open.textContent='Open';
      const download=document.createElement('a');
      download.href=item.url;
      download.download='';
      download.rel='noopener noreferrer';
      download.textContent='Download';
      actions.append(open,download);
      body.append(name,detail,actions);
      card.appendChild(body);
      panel.appendChild(card);
    });

    close.addEventListener('click',closeOutputs);
    backdrop.addEventListener('click',closeOutputs);
    document.body.append(backdrop,panel);
  };

  const closeSources=()=>{
    document.querySelector('.zuvyr-sources-backdrop')?.remove();
    document.querySelector('.zuvyr-sources-panel')?.remove();
  };

  const openSources=sources=>{
    closeSources();
    const backdrop=document.createElement('div');
    backdrop.className='zuvyr-sources-backdrop';
    const panel=document.createElement('aside');
    panel.className='zuvyr-sources-panel';
    const header=document.createElement('div');
    header.className='zuvyr-sources-header';
    const title=document.createElement('span');
    title.textContent=labels().sources;
    const close=document.createElement('button');
    close.type='button';
    close.className='zuvyr-sources-close';
    close.setAttribute('aria-label','Close');
    close.textContent='\u00d7';
    header.append(title,close);
    panel.appendChild(header);

    sources.forEach(source=>{
      const card=document.createElement(source.url?'a':'div');
      card.className='zuvyr-source-card';
      if(source.url){
        card.href=source.url;
        card.target='_blank';
        card.rel='noopener noreferrer';
      }else{
        card.classList.add('zuvyr-source-file');
      }
      const cardTitle=document.createElement('span');
      cardTitle.className='zuvyr-source-title';
      cardTitle.textContent=source.title;
      const detail=document.createElement('span');
      detail.className='zuvyr-source-url';
      detail.textContent=source.url||[
        source.mimeType||source.assetType||'File',
        source.extractionStatus||''
      ].filter(Boolean).join(' Â· ');
      card.append(cardTitle,detail);
      panel.appendChild(card);
    });

    close.addEventListener('click',closeSources);
    backdrop.addEventListener('click',closeSources);
    document.body.append(backdrop,panel);
  };

  const enhance=actions=>{
    if(!actions?.isConnected||actions.dataset.zuvyrActionsV2==='1') return;
    if(!actions.classList.contains('rox-gpt-actions')) return;

    const like=actions.querySelector('[data-i18n-title="feedback.like"]');
    const dislike=actions.querySelector('[data-i18n-title="feedback.dislike"]');
    const share=actions.querySelector('[data-i18n-title="feedback.share"]');
    const moreWrap=actions.querySelector(':scope > .rox-gpt-more-wrap');

    if(!like||!dislike||!share||!moreWrap) return;

    actions.dataset.zuvyrActionsV2='1';
    like.classList.add('zuvyr-original-rating-action');
    dislike.classList.add('zuvyr-original-rating-action');

    const text=labels();
    const ratingWrap=document.createElement('div');
    ratingWrap.className='zuvyr-rating-wrap';

    const ratingButton=document.createElement('button');
    ratingButton.type='button';
    ratingButton.className='msg-action zuvyr-rating-button';
    ratingButton.innerHTML='<svg class="zuvyr-rate-chatgpt-exact" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M15.37 10.324c0-.452-.003-.661-.018-.79l-.02-.107a1.14 1.14 0 0 0-.664-.758l-.143-.049c-.119-.032-.12-.03-.147-.033l-.46-.005-.136-.014a.665.665 0 0 1 .135-1.316h1.637c.494 0 .906-.001 1.24.026.342.028.662.088.965.243l.17.095c.387.238.703.578.91.985l.053.114c.115.268.165.551.19.85.026.335.026.746.026 1.24v1.69c-.003.285-.013.528-.055.747l-.03.13a2.47 2.47 0 0 1-1.588 1.698l-.159.048c-.335.09-.724.084-1.24.084-.1 0-.195.04-.264.11l-.06.078-2.108 3.69a.67.67 0 0 1-.66.33l-.273-.034a2.472 2.472 0 0 1-2.056-3.179l.307-.995H10a.665.665 0 0 1 0-1.33h1.822a.666.666 0 0 1 .636.86l-.571 1.857a1.14 1.14 0 0 0 .789 1.434l1.882-3.293.06-.097c.186-.281.45-.496.752-.625zM7.075.59l.274.034.14.022a2.47 2.47 0 0 1 1.952 3.019l-.038.138-.31 1.002q.26.005.475.021c.367.029.712.09 1.027.256l.232.14c.52.352.89.891 1.028 1.511l.025.13c.045.305.013.611-.047.928q-.051.27-.138.6l-.196.731-.274 1.008c-.168.616-.293 1.107-.535 1.497l-.112.161c-.23.3-.527.541-.865.707l-.147.067c-.483.199-1.04.186-1.77.186H4.465c-.495 0-.906.001-1.24-.026a2.7 2.7 0 0 1-.85-.19l-.115-.053a2.47 2.47 0 0 1-.985-.91l-.094-.17c-.154-.302-.215-.622-.243-.964C.91 10.1.91 9.689.91 9.195V7.87c0-.517-.006-.906.084-1.241l.048-.157c.265-.777.9-1.376 1.7-1.59l.128-.03c.306-.059.66-.054 1.112-.054a.37.37 0 0 0 .324-.188L6.415.92l.056-.082A.67.67 0 0 1 7.075.59M16.7 13.862c.111-.005.177-.014.233-.029l.143-.049c.324-.135.571-.413.663-.758l.02-.107c.015-.129.018-.338.018-.79v-1.323c0-.517 0-.864-.021-1.132a1.6 1.6 0 0 0-.071-.398l-.032-.072c-.082-.16-.2-.299-.345-.404l-.153-.094c-.083-.043-.21-.08-.47-.102a6 6 0 0 0-.26-.014q.121.233.191.493l.03.128c.042.219.052.462.054.748zM4.65 9.676c0 .602.005.774.039.897l.048.143c.135.324.414.572.758.664l.108.02c.128.015.337.018.789.018h1.405c.85 0 1.082-.012 1.262-.086l.133-.065a1.1 1.1 0 0 0 .334-.292l.043-.062c.097-.156.178-.416.373-1.134l.275-1.008.191-.711c.052-.201.091-.37.12-.517.041-.219.049-.353.041-.443l-.01-.079a1.14 1.14 0 0 0-.476-.698l-.107-.064c-.08-.042-.216-.084-.511-.107a18 18 0 0 0-1.268-.024.665.665 0 0 1-.635-.86l.57-1.857.032-.127a1.14 1.14 0 0 0-.82-1.307L5.46 5.27a1.7 1.7 0 0 1-.812.72zM2.24 9.194c0 .517 0 .864.023 1.132.021.26.059.386.101.47l.094.152c.105.145.244.264.405.346l.073.031c.082.03.202.055.396.07q.12.01.26.014a2.5 2.5 0 0 1-.143-.334l-.048-.158c-.09-.335-.084-.724-.084-1.241v-3.54q-.073.004-.124.01l-.107.021a1.14 1.14 0 0 0-.758.663l-.049.144c-.033.123-.039.294-.039.896z"/></svg>';
    ratingButton.title=text.rate;
    ratingButton.setAttribute('aria-label',text.rate);
    ratingButton.setAttribute('aria-haspopup','menu');
    ratingButton.setAttribute('aria-expanded','false');

    const ratingMenu=document.createElement('div');
    ratingMenu.className='zuvyr-rating-menu';
    ratingMenu.hidden=true;

    const option=(markup,label,target)=>{
      const button=document.createElement('button');
      button.type='button';
      button.className='zuvyr-rating-option';
      button.innerHTML=markup+'<span></span>';
      button.querySelector('span').textContent=label;
      button.addEventListener('click',event=>{
        event.stopPropagation();
        ratingMenu.hidden=true;
        ratingButton.setAttribute('aria-expanded','false');
        target.click();
        setTimeout(()=>{
          ratingButton.classList.toggle(
            'is-active',
            like.classList.contains('is-active')||
            dislike.classList.contains('is-active')
          );
        },500);
      });
      return button;
    };

    ratingMenu.append(
      option(thumbUp,text.good,like),
      option(thumbDown,text.bad,dislike)
    );

    ratingWrap.append(ratingButton,ratingMenu);
    actions.insertBefore(ratingWrap,share);

    ratingButton.addEventListener('click',event=>{
      event.stopPropagation();
      document.querySelectorAll('.zuvyr-rating-menu').forEach(menu=>{
        if(menu!==ratingMenu) menu.hidden=true;
      });
      const open=ratingMenu.hidden;
      ratingMenu.hidden=!open;
      ratingButton.setAttribute('aria-expanded',String(open));
    });

    const menuItems=Array.from(
      moreWrap.querySelectorAll('.rox-gpt-menu-item')
    );
    const sourcesButton=menuItems[0];
    const branchButton=menuItems[1];
    const message=messageFor(actions);
    const sources=collectSources(message);
    const outputs=collectOutputs(message);
    const outputsButton=document.createElement('button');
    outputsButton.type='button';
    outputsButton.className='rox-gpt-menu-item zuvyr-outputs-menu-item';
    outputsButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"></path><path d="m8 14 2.5-3 2 2 2.5-3 3 4"></path></svg><span></span>';
    outputsButton.querySelector('span').textContent=text.outputs;
    const menu=moreWrap.querySelector('.rox-gpt-more-menu');
    if(menu) menu.insertBefore(outputsButton,branchButton||null);
    outputsButton.style.display=outputs.length?'':'none';
    outputsButton.addEventListener('click',event=>{
      event.preventDefault();
      event.stopImmediatePropagation();
      if(menu) menu.hidden=true;
      moreWrap.querySelector('.rox-gpt-more-button')
        ?.setAttribute('aria-expanded','false');
      openOutputs(outputs);
    },true);

    if(sourcesButton){
      if(!sources.length){
        sourcesButton.style.display='none';
      }else{
        sourcesButton.style.display='';
        sourcesButton.addEventListener('click',event=>{
          event.preventDefault();
          event.stopImmediatePropagation();
          moreWrap.querySelector('.rox-gpt-more-menu').hidden=true;
          moreWrap.querySelector('.rox-gpt-more-button')
            ?.setAttribute('aria-expanded','false');
          openSources(sources);
        },true);
      }
    }

    if(branchButton){
      branchButton.addEventListener('click',async event=>{
        event.preventDefault();
        event.stopImmediatePropagation();

        const menu=moreWrap.querySelector('.rox-gpt-more-menu');
        const more=moreWrap.querySelector('.rox-gpt-more-button');
        if(menu) menu.hidden=true;
        more?.setAttribute('aria-expanded','false');

        const meta=message?._zuvyrMeta||{};
        const conversationId=
          meta.conversationId||
          message?.dataset.zuvyrConversationId||
          (
            typeof activeRoxConversationIds!=='undefined'
              ?activeRoxConversationIds.chat
              :null
          );

        if(!conversationId){
          toast(text.branchFailed);
          return;
        }

        branchButton.disabled=true;
        toast(text.branching);

        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),20000);

        try{
          const response=await authFetch(
            '/api/conversations/'+
            encodeURIComponent(conversationId)+
            '/branch',
            {
              method:'POST',
              signal:controller.signal,
              body:JSON.stringify({
                throughSequence:
                  Number(meta.sequenceNo)||
                  Number(message?.dataset.zuvyrSequenceNo)||
                  undefined
              })
            }
          );

          const data=await response.json().catch(()=>({}));

          if(!response.ok||!data.conversation){
            throw new Error(
              data.message||
              'conversation_branch_failed'
            );
          }

          if(typeof openRoxHistoryItem!=='function'){
            throw new Error('history_open_unavailable');
          }

          await openRoxHistoryItem(data.conversation,null);
          toast(text.branchDone);
        }catch(error){
          console.error('ZUVYR branch V2 failed:',error);
          toast(
            error?.name==='AbortError'
              ?text.branchFailed+' (timeout)'
              :text.branchFailed
          );
        }finally{
          clearTimeout(timer);
          branchButton.disabled=false;
        }
      },true);
    }
  };

  const scan=root=>{
    if(root?.matches?.('.msg-actions')) enhance(root);
    root?.querySelectorAll?.('.msg-actions').forEach(enhance);
  };

  document.addEventListener('pointerdown',event=>{
    if(!event.target.closest('.zuvyr-rating-wrap')){
      document.querySelectorAll('.zuvyr-rating-menu')
        .forEach(menu=>menu.hidden=true);
      document.querySelectorAll('.zuvyr-rating-button')
        .forEach(button=>button.setAttribute('aria-expanded','false'));
    }
  });

  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){
      closeSources();
      document.querySelectorAll('.zuvyr-rating-menu')
        .forEach(menu=>menu.hidden=true);
    }
  });

  scan(document);
  new MutationObserver(records=>{
    records.forEach(record=>{
      record.addedNodes.forEach(node=>{
        if(node.nodeType===1) scan(node);
      });
    });
  }).observe(document.documentElement,{childList:true,subtree:true});
})();
/* ZUVYR CHATGPT SIDEBAR PHASE 1 */
(function(){
  'use strict';
  const searchIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16.5 16.5 4 4"></path></svg>';
  const collapseIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M9 4v16"></path></svg>';
  const composeIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h7"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L11 15l-4 1 1-4 8.5-8.5Z"></path></svg>';
  const chatIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15a3 3 0 0 1-3 3H9l-5 2 1.4-3.6A6 6 0 0 1 4 12.5V9a4 4 0 0 1 4-4h9a3 3 0 0 1 3 3v7Z"></path></svg>';
  let searchTimer=0;
  let requestSequence=0;

  const safeDate=value=>{
    if(!value)return '';
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return '';
    return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(date);
  };

  const buildSearchLayer=workspace=>{
    let layer=workspace.querySelector(':scope > .zuvyr-chat-search-layer');
    if(layer)return layer;
    layer=document.createElement('div');
    layer.className='zuvyr-chat-search-layer';
    layer.hidden=true;
    layer.innerHTML='<section class="zuvyr-chat-search-dialog" role="dialog" aria-modal="true" aria-label="Search chats"><div class="zuvyr-chat-search-field">'+searchIcon+'<input type="search" autocomplete="off" placeholder="Search chats" aria-label="Search chats"><button type="button" class="zuvyr-chat-search-close" aria-label="Close search">&#10005;</button></div><div class="zuvyr-chat-search-results"><div class="zuvyr-search-state">Type to search your chats.</div></div></section>';
    workspace.appendChild(layer);
    const input=layer.querySelector('input');
    const results=layer.querySelector('.zuvyr-chat-search-results');
    const close=()=>{layer.hidden=true;input.value='';clearTimeout(searchTimer)};
    const state=text=>{results.replaceChildren();const node=document.createElement('div');node.className='zuvyr-search-state';node.textContent=text;results.appendChild(node)};
    const render=items=>{
      results.replaceChildren();
      if(!items.length){state('No matching chats found.');return}
      items.forEach(item=>{
        const row=document.createElement('button');row.type='button';row.className='zuvyr-search-result';
        const icon=document.createElement('span');icon.className='zuvyr-search-result-icon';icon.innerHTML=chatIcon;
        const copy=document.createElement('span');copy.className='zuvyr-search-result-copy';
        const title=document.createElement('span');title.className='zuvyr-search-result-title';title.textContent=String(item?.title||'New conversation');
        const meta=document.createElement('span');meta.className='zuvyr-search-result-meta';meta.textContent=[String(item?.feature||'chat').toUpperCase(),safeDate(item?.last_message_at||item?.updated_at||item?.created_at)].filter(Boolean).join(' Â· ');
        copy.append(title,meta);row.append(icon,copy);
        row.addEventListener('click',async()=>{row.disabled=true;try{if(typeof openRoxHistoryItem!=='function')throw new Error('history_open_unavailable');await openRoxHistoryItem(item,null);close()}catch(error){console.error('[zuvyr-sidebar-search] open failed:',error);row.disabled=false}});
        results.appendChild(row);
      });
    };
    const search=async value=>{
      const term=String(value||'').trim().slice(0,80);const sequence=++requestSequence;if(!term){state('Type to search your chats.');return}state('Searching...');
      try{
        const query='/api/conversations?limit=100&archived=false'+(term?'&search='+encodeURIComponent(term):'');
        const response=await authFetch(query,{method:'GET'});const data=await response.json().catch(()=>({}));
        if(sequence!==requestSequence)return;
        if(!response.ok||data.status!=='success')throw new Error(data.message||('HTTP '+response.status));
        render(Array.isArray(data.items)?data.items:[]);
      }catch(error){if(sequence!==requestSequence)return;console.error('[zuvyr-sidebar-search] search failed:',error);state('Search could not be loaded.')}
    };
    const open=()=>{layer.hidden=false;input.focus();input.select();search(input.value)};
    input.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>search(input.value),180)});
    layer.querySelector('.zuvyr-chat-search-close').addEventListener('click',close);
    layer.addEventListener('pointerdown',event=>{if(event.target===layer)close()});
    layer.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close()}});
    layer._zuvyrOpenSearch=open;
    return layer;
  };

  const enhance=sidebar=>{
    if(!sidebar||sidebar.dataset.zuvyrSidebarPhase1==='1')return;
    const workspace=sidebar.closest('.zuvyr-chat-workspace');
    const brand=sidebar.querySelector('.zuvyr-chat-brand');
    const primary=sidebar.querySelector('.zuvyr-chat-primary');
    const newChat=sidebar.querySelector('.zuvyr-sidebar-new-chat');
    if(!workspace||!brand||!primary||!newChat)return;
    sidebar.dataset.zuvyrSidebarPhase1='1';
    const layer=buildSearchLayer(workspace);
    const search=document.createElement('button');search.type='button';search.className='zuvyr-sidebar-search';search.title='Search';search.setAttribute('aria-label','Search chats');search.innerHTML='<span class="zuvyr-sidebar-nav-icon">'+searchIcon+'</span><span>Search</span><small class="zuvyr-sidebar-search-shortcut">Ctrl K</small>';search.addEventListener('click',()=>layer._zuvyrOpenSearch?.());
    const collapse=document.createElement('button');collapse.type='button';collapse.className='zuvyr-sidebar-head-action zuvyr-sidebar-collapse';collapse.title='Toggle sidebar';collapse.setAttribute('aria-label','Toggle sidebar');collapse.innerHTML=collapseIcon;collapse.addEventListener('click',()=>workspace.classList.toggle('zuvyr-sidebar-collapsed'));
    brand.appendChild(collapse);primary.prepend(search);
    const pinned=document.createElement('section');pinned.className='zuvyr-sidebar-pinned';pinned.hidden=true;pinned.innerHTML='<div class="zuvyr-sidebar-pinned-title">Pinned</div><div class="zuvyr-sidebar-pinned-list"></div>';
    const recents=document.createElement('section');recents.className='zuvyr-sidebar-recents';recents.innerHTML='<div class="zuvyr-sidebar-recents-title">Recents</div><div class="zuvyr-sidebar-recents-list"><div class="zuvyr-sidebar-recents-state">Loading...</div></div>';
    const pinnedList=pinned.querySelector('.zuvyr-sidebar-pinned-list');
    const recentsList=recents.querySelector('.zuvyr-sidebar-recents-list');
    /* ZUVYR SIDEBAR CONVERSATION ACTIONS */
    const actionsMenu=document.createElement('div');actionsMenu.className='zuvyr-conversation-menu';actionsMenu.hidden=true;document.body.appendChild(actionsMenu);
    const closeConversationMenu=()=>{actionsMenu.hidden=true;actionsMenu.innerHTML=''};
    const updateConversation=async(item,payload)=>{const response=await authFetch('/api/conversations/'+encodeURIComponent(item.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await response.json().catch(()=>({}));if(!response.ok||data.status!=='success'||!data.conversation)throw new Error(data.message||('HTTP '+response.status));Object.assign(item,data.conversation);return data.conversation};
    const shareConversation=async item=>{if(typeof loadAllRoxConversationMessages!=='function')throw new Error('conversation_messages_unavailable');const messages=await loadAllRoxConversationMessages(item.id);const transcript=messages.filter(message=>message&&(message.role==='user'||message.role==='assistant')).map(message=>(message.role==='user'?'You':'ZUVYR')+':\n'+String(message.plain_text||message.content?.text||'').trim()).filter(text=>!text.endsWith(':\n')).join('\n\n');if(!transcript)throw new Error('conversation_empty');const shareData={title:String(item.title||'ZUVYR conversation'),text:transcript};if(navigator.share){await navigator.share(shareData)}else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText((shareData.title+'\n\n'+transcript).trim());window.alert('Conversation copied. You can send it to anyone.')}else{throw new Error('share_unavailable')}};
    const menuIcon={share:'<svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 13v6h14v-6"/></svg>',rename:'<svg viewBox="0 0 24 24"><path d="m4 20 4.2-1 10.6-10.6-3.2-3.2L5 15.8 4 20Zm9.7-12.9 3.2 3.2"/></svg>',pin:'<svg viewBox="0 0 24 24"><path d="m14.5 4 5.5 5.5-3 1.2-3.5 3.5.5 3.3-1.5 1.5-7.5-7.5L6.5 10l3.3.5 3.5-3.5L14.5 4ZM5 19l4-4"/></svg>',delete:'<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>'};
    const openConversationMenu=(item,row,trigger)=>{actionsMenu.innerHTML='';const add=(icon,label,className,handler)=>{const button=document.createElement('button');button.type='button';button.className='zuvyr-conversation-menu-item'+(className?' '+className:'');button.innerHTML=menuIcon[icon]+'<span></span>';button.querySelector('span').textContent=label;button.addEventListener('click',async event=>{event.stopPropagation();button.disabled=true;try{await handler();closeConversationMenu()}catch(error){if(error?.name!=='AbortError'){console.error('[zuvyr-conversation-action] failed:',error);window.alert('This action could not be completed.')}button.disabled=false}});actionsMenu.appendChild(button)};add('share','Share conversation','',()=>shareConversation(item));add('rename','Rename','',async()=>{const next=window.prompt('Rename conversation',String(item.title||'New conversation'));if(next===null)return;const title=next.replace(/\s+/g,' ').trim().slice(0,120);if(!title)return;await updateConversation(item,{title});row.querySelector('.zuvyr-sidebar-recent-title').textContent=title;if(typeof activeRoxConversationIds!=='undefined'&&String(activeRoxConversationIds.chat||'')===String(item.id)){window.dispatchEvent(new CustomEvent('rox:conversation-title',{detail:{feature:'chat',title}}))}});const divider=document.createElement('div');divider.className='zuvyr-conversation-menu-divider';actionsMenu.appendChild(divider);add('pin',item.pinned?'Unpin chat':'Pin chat','',async()=>{await updateConversation(item,{pinned:!item.pinned});await loadRecents()});add('delete','Delete','is-danger',async()=>{if(!window.confirm('Delete this conversation?'))return;await updateConversation(item,{archived:true});if(typeof activeRoxConversationIds!=='undefined'&&String(activeRoxConversationIds.chat||'')===String(item.id)){resetActiveRoxConversation?.('chat')}await loadRecents()});actionsMenu.hidden=false;const rect=trigger.getBoundingClientRect();const width=220;const left=Math.min(window.innerWidth-width-10,Math.max(10,rect.right-width));const height=actionsMenu.offsetHeight;actionsMenu.style.left=left+'px';actionsMenu.style.top=Math.min(window.innerHeight-height-10,rect.bottom+6)+'px'};
    document.addEventListener('pointerdown',event=>{if(!actionsMenu.hidden&&!actionsMenu.contains(event.target)&&!event.target.closest('.zuvyr-sidebar-recent-more'))closeConversationMenu()});
    document.addEventListener('keydown',event=>{if(event.key==='Escape')closeConversationMenu()});
    const loadRecents=async()=>{try{closeConversationMenu();const response=await authFetch('/api/conversations?limit=100&archived=false&_zuvyr='+Date.now(),{method:'GET',cache:'no-store'});const data=await response.json().catch(()=>({}));if(!response.ok||data.status!=='success')throw new Error(data.message||('HTTP '+response.status));const items=Array.isArray(data.items)?data.items:[];const pinnedItems=items.filter(item=>Boolean(item.pinned));const recentItems=items.filter(item=>!Boolean(item.pinned));pinnedList.innerHTML='';recentsList.innerHTML='';pinned.hidden=!pinnedItems.length;if(!items.length){const empty=document.createElement('div');empty.className='zuvyr-sidebar-recents-state';empty.textContent='No conversations yet.';recentsList.appendChild(empty);return}const renderItems=(sectionItems,target)=>sectionItems.forEach(item=>{const row=document.createElement('div');row.className='zuvyr-sidebar-recent';row.dataset.conversationId=String(item.id||'');row.tabIndex=0;row.setAttribute('role','button');const bubble=document.createElement('span');bubble.className='zuvyr-sidebar-recent-icon';bubble.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5a3.5 3.5 0 0 1-3.5 3.5H9l-5 2.4 1.3-3.8A6.8 6.8 0 0 1 4 12.6V9a4 4 0 0 1 4-4h8.5A3.5 3.5 0 0 1 20 8.5v6Z"/></svg>';const title=document.createElement('span');title.className='zuvyr-sidebar-recent-title';title.textContent=String(item.title||'New conversation').replace(/\s+/g,' ').trim().slice(0,80);const controls=document.createElement('span');controls.className='zuvyr-sidebar-recent-controls';const pin=document.createElement('button');pin.type='button';pin.className='zuvyr-sidebar-recent-pin'+(item.pinned?' is-pinned':'');pin.title=item.pinned?'Unpin chat':'Pin chat';pin.setAttribute('aria-label',pin.title);pin.innerHTML=menuIcon.pin;pin.addEventListener('click',async event=>{event.stopPropagation();pin.disabled=true;try{await updateConversation(item,{pinned:!item.pinned});await loadRecents()}catch(error){console.error('[zuvyr-sidebar-pin] failed:',error);window.alert('Pin could not be updated.');pin.disabled=false}});const more=document.createElement('button');more.type='button';more.className='zuvyr-sidebar-recent-more';more.title='Conversation options';more.setAttribute('aria-label','Conversation options');more.innerHTML='<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>';more.addEventListener('click',event=>{event.stopPropagation();if(!actionsMenu.hidden){closeConversationMenu();return}openConversationMenu(item,row,more)});controls.append(pin,more);row.append(bubble,title,controls);const openItem=async()=>{if(row.dataset.loading==='1')return;row.dataset.loading='1';try{if(typeof openRoxHistoryItem!=='function')throw new Error('history_open_unavailable');await openRoxHistoryItem(item,null);sidebar.querySelectorAll('.zuvyr-sidebar-recent').forEach(node=>node.classList.toggle('is-active',node===row))}catch(error){console.error('[zuvyr-sidebar-recents] open failed:',error)}finally{delete row.dataset.loading}};row.addEventListener('click',openItem);row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openItem()}});target.appendChild(row)});renderItems(pinnedItems,pinnedList);renderItems(recentItems,recentsList);if(!recentItems.length){const emptyRecent=document.createElement('div');emptyRecent.className='zuvyr-sidebar-recents-state';emptyRecent.textContent='No recent conversations.';recentsList.appendChild(emptyRecent)}}catch(error){console.error('[zuvyr-sidebar-recents] load failed:',error);pinned.hidden=true;pinnedList.innerHTML='';recentsList.innerHTML='';const failed=document.createElement('div');failed.className='zuvyr-sidebar-recents-state';failed.textContent='Could not load conversations.';recentsList.appendChild(failed)}};
    primary.after(pinned,recents);loadRecents();
    /* ZUVYR SIDEBAR CONVERSATION ACTIONS END */
    const symbol=newChat.querySelector('.rox-new-chat-symbol');if(symbol)symbol.innerHTML=composeIcon;
    newChat.title='New chat';newChat.setAttribute('aria-label','New chat');
    const label=newChat.querySelector('.rox-new-chat-label');if(label){label.textContent='New chat';label.removeAttribute('data-i18n')}
  };

  const scan=root=>{if(root?.matches?.('.zuvyr-chat-sidebar'))enhance(root);root?.querySelectorAll?.('.zuvyr-chat-sidebar').forEach(enhance)};
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&String(event.key).toLowerCase()==='k'){const sidebar=document.querySelector('#feature-chat.active .zuvyr-chat-sidebar');if(!sidebar)return;event.preventDefault();enhance(sidebar);sidebar.closest('.zuvyr-chat-workspace')?.querySelector('.zuvyr-chat-search-layer')?._zuvyrOpenSearch?.()}});
  scan(document);
  new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1)scan(node)}))).observe(document.documentElement,{childList:true,subtree:true});
})();
/* ZUVYR CHATGPT SIDEBAR PHASE 1 END */

/* ZUVYR USER MESSAGE ACTIONS V1 */
(()=>{
  'use strict';

  const labels=()=>{
    const lang=String(document.documentElement.lang||'en').toLowerCase();
    if(lang.startsWith('ar'))return{
      copy:'\u0646\u0633\u062e',
      copied:'\u062a\u0645 \u0627\u0644\u0646\u0633\u062e',
      share:'\u0645\u0634\u0627\u0631\u0643\u0629 \u0627\u0644\u0637\u0644\u0628',
      edit:'\u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0646\u0635',
      cancel:'\u0625\u0644\u063a\u0627\u0621',
      send:'\u0625\u0631\u0633\u0627\u0644',
      unavailable:'\u062a\u0639\u0630\u0631 \u062a\u0639\u062f\u064a\u0644 \u0647\u0630\u0647 \u0627\u0644\u0631\u0633\u0627\u0644\u0629.',
      failed:'\u062a\u0639\u0630\u0631 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u0639\u062f\u0644.'
    };
    if(lang.startsWith('fr'))return{
      copy:'Copier',copied:'Copie effectuee',share:'Partager le prompt',
      edit:'Modifier le texte',cancel:'Annuler',send:'Envoyer',
      unavailable:'Cette demande ne peut pas etre modifiee.',
      failed:'Impossible d envoyer le texte modifie.'
    };
    if(lang.startsWith('es'))return{
      copy:'Copiar',copied:'Copiado',share:'Compartir prompt',
      edit:'Editar texto',cancel:'Cancelar',send:'Enviar',
      unavailable:'No se puede editar este mensaje.',
      failed:'No se pudo enviar el texto editado.'
    };
    return{
      copy:'Copy',copied:'Copied',share:'Share prompt',
      edit:'Edit text',cancel:'Cancel',send:'Send',
      unavailable:'This message cannot be edited.',
      failed:'Could not send the edited text.'
    };
  };

  const icons={
    copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>',
    share:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4"></path><path d="m7 9 5-5 5 5"></path><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"></path></svg>',
    edit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.8 4 4-.8L18.5 7.9a2.1 2.1 0 0 0-3-3Z"></path><path d="m14 6 4 4"></path></svg>',
    check:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>'
  };

  const toast=value=>{
    document.querySelector('.zuvyr-action-toast')?.remove();
    const node=document.createElement('div');
    node.className='zuvyr-action-toast';
    node.textContent=value;
    document.body.appendChild(node);
    setTimeout(()=>node.remove(),2600);
  };

  const messageText=message=>String(
    message.querySelector('.zuvyr-sent-image-caption')?.textContent||
    message.textContent||
    ''
  ).trim();

  const copyText=async value=>{
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(value);
      return;
    }
    const area=document.createElement('textarea');
    area.value=value;
    area.style.position='fixed';
    area.style.opacity='0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  };

  const closeMenus=except=>{
    document.querySelectorAll('.zuvyr-user-actions.is-open').forEach(menu=>{
      if(menu!==except)menu.classList.remove('is-open');
    });
  };

  const closeEditors=()=>{
    document.querySelectorAll('.zuvyr-user-editor').forEach(editor=>{
      editor._message?.classList.remove('is-zuvyr-editing');
      if(editor._actions)editor._actions.hidden=false;
      editor.remove();
    });
  };

  const openMobileMenu=(actions,x,y)=>{
    closeMenus(actions);
    actions.classList.add('is-open');
    const width=230;
    const left=Math.max(12,Math.min(x-width/2,window.innerWidth-width-12));
    actions.style.left=left+'px';
    const height=actions.offsetHeight||150;
    actions.style.top=Math.max(12,Math.min(y+12,window.innerHeight-height-12))+'px';
  };

  const startEditor=(message,actions)=>{
    const text=labels();
    const original=messageText(message);
    if(!original)return;

    closeMenus();
    closeEditors();

    const editor=document.createElement('div');
    editor.className='zuvyr-user-editor';
    editor._message=message;
    editor._actions=actions;

    const input=document.createElement('textarea');
    input.value=original;
    input.setAttribute('aria-label',text.edit);

    const footer=document.createElement('div');
    footer.className='zuvyr-user-editor-footer';

    const cancel=document.createElement('button');
    cancel.type='button';
    cancel.className='zuvyr-user-editor-button';
    cancel.textContent=text.cancel;

    const send=document.createElement('button');
    send.type='button';
    send.className='zuvyr-user-editor-button is-send';
    send.textContent=text.send;

    footer.append(cancel,send);
    editor.append(input,footer);
    message.classList.add('is-zuvyr-editing');
    actions.hidden=true;
    message.parentNode.insertBefore(editor,actions);

    const restore=()=>{
      message.classList.remove('is-zuvyr-editing');
      actions.hidden=false;
      editor.remove();
    };

    cancel.addEventListener('click',restore);

    send.addEventListener('click',async()=>{
      const value=input.value.trim();
      if(!value)return;

      const meta=message._zuvyrMeta||{};
      const conversationId=String(
        meta.conversationId||
        message.dataset.zuvyrConversationId||
        ''
      );
      const sequenceNo=Number(
        meta.sequenceNo||
        message.dataset.zuvyrSequenceNo
      );

      if(!conversationId||!Number.isInteger(sequenceNo)||sequenceNo<1){
        toast(text.unavailable);
        return;
      }

      send.disabled=true;
      cancel.disabled=true;

      try{
        let response;

        if(sequenceNo===1){
          response=await authFetch('/api/conversations',{
            method:'POST',
            body:JSON.stringify({
              feature:'chat',
              title:value.replace(/\s+/g,' ').slice(0,80)
            })
          });
        }else{
          response=await authFetch(
            '/api/conversations/'+encodeURIComponent(conversationId)+'/branch',
            {
              method:'POST',
              body:JSON.stringify({
                throughSequence:sequenceNo-1
              })
            }
          );
        }

        const data=await response.json().catch(()=>({}));

        if(!response.ok||!data.conversation){
          throw new Error(data.message||'conversation_edit_branch_failed');
        }

        if(typeof openRoxHistoryItem!=='function'||typeof sendMessage!=='function'){
          throw new Error('conversation_edit_ui_unavailable');
        }

        await openRoxHistoryItem(data.conversation,null);

        const composer=document.querySelector(
          '#feature-chat textarea[data-feature="chat"],'+
          '#feature-chat input[data-feature="chat"]'
        );

        if(!composer)throw new Error('conversation_edit_composer_missing');

        composer.value=value;
        composer.dispatchEvent(new Event('input',{bubbles:true}));
        sendMessage('chat');
      }catch(error){
        console.error('ZUVYR user message edit failed:',error);
        toast(text.failed);
        send.disabled=false;
        cancel.disabled=false;
      }
    });

    input.addEventListener('keydown',event=>{
      if(event.key==='Enter'&&!event.shiftKey){
        event.preventDefault();
        send.click();
      }
      if(event.key==='Escape')cancel.click();
    });

    requestAnimationFrame(()=>{
      input.focus();
      input.setSelectionRange(input.value.length,input.value.length);
    });
  };

  const makeButton=(name,label,handler)=>{
    const button=document.createElement('button');
    button.type='button';
    button.className='zuvyr-user-action zuvyr-user-action-'+name;
    button.title=label;
    button.setAttribute('aria-label',label);
    button.innerHTML=icons[name]+'<span class="zuvyr-user-action-label"></span>';
    button.querySelector('.zuvyr-user-action-label').textContent=label;
    button.addEventListener('click',event=>{
      event.preventDefault();
      event.stopPropagation();
      closeMenus();
      Promise.resolve(handler(button)).catch(error=>
        console.error('ZUVYR user message action failed:',error)
      );
    });
    return button;
  };

  const enhance=message=>{
    if(
      !message||
      message.dataset.zuvyrUserActionsReady==='true'||
      !message.matches('#feature-chat #msgs-chat>.msg.user')
    )return;

    message.dataset.zuvyrUserActionsReady='true';
    const text=labels();
    const actions=document.createElement('div');
    actions.className='zuvyr-user-actions';

    actions.append(
      makeButton('copy',text.copy,async button=>{
        const value=messageText(message);
        if(!value)return;
        await copyText(value);
        const idleHtml=button.innerHTML;
        button.classList.add('is-copied');
        button.innerHTML=icons.check+'<span class="zuvyr-user-action-label"></span>';
        button.querySelector('.zuvyr-user-action-label').textContent=text.copied;
        button.title=text.copied;
        button.setAttribute('aria-label',text.copied);
        setTimeout(()=>{
          if(!button.isConnected)return;
          button.classList.remove('is-copied');
          button.innerHTML=idleHtml;
          button.title=text.copy;
          button.setAttribute('aria-label',text.copy);
        },1600);
      }),
      makeButton('share',text.share,async()=>{
        const value=messageText(message);
        if(!value)return;
        if(navigator.share){
          try{
            await navigator.share({title:'ZUVYR',text:value});
          }catch(error){
            if(error?.name!=='AbortError')throw error;
          }
        }else{
          await copyText(value);
          toast(text.copied);
        }
      }),
      makeButton('edit',text.edit,()=>startEditor(message,actions))
    );

    message.insertAdjacentElement('afterend',actions);

    let timer=null;
    let startX=0;
    let startY=0;

    const clear=()=>{
      if(timer){
        clearTimeout(timer);
        timer=null;
      }
    };

    message.addEventListener('pointerdown',event=>{
      if(!matchMedia('(hover:none),(pointer:coarse)').matches)return;
      startX=event.clientX;
      startY=event.clientY;
      clear();
      timer=setTimeout(()=>{
        timer=null;
        openMobileMenu(actions,startX,startY);
      },500);
    });

    message.addEventListener('pointermove',event=>{
      if(Math.hypot(event.clientX-startX,event.clientY-startY)>10)clear();
    });

    message.addEventListener('pointerup',clear);
    message.addEventListener('pointercancel',clear);

    message.addEventListener('contextmenu',event=>{
      if(!matchMedia('(hover:none),(pointer:coarse)').matches)return;
      event.preventDefault();
      clear();
      openMobileMenu(actions,event.clientX,event.clientY);
    });
  };

  const scan=root=>{
    if(root?.matches?.('#feature-chat #msgs-chat>.msg.user'))enhance(root);
    root?.querySelectorAll?.('#feature-chat #msgs-chat>.msg.user').forEach(enhance);
  };

  const boot=()=>{
    scan(document);
    new MutationObserver(records=>{
      records.forEach(record=>
        record.addedNodes.forEach(node=>{
          if(node.nodeType===1)scan(node);
        })
      );
    }).observe(document.body,{childList:true,subtree:true});

    document.addEventListener('pointerdown',event=>{
      if(!event.target.closest('.zuvyr-user-actions,.msg.user')){
        closeMenus();
      }
    });
  };

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',boot,{once:true});
  }else{
    boot();
  }
})();
