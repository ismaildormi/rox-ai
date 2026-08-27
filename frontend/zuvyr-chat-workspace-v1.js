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
    main.append(topbar, messages, composer);
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
          'input[data-feature="chat"]'
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
/* ZUVYR ATTACH MENU V1 */
(() => {
  const plusIcon = `
    <svg class="zuvyr-attach-plus" viewBox="0 0 24 24" aria-hidden="true"
      fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <path d="M12 5v14"></path><path d="M5 12h14"></path>
    </svg>`;

  const historyIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none"
      stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7"></path>
      <path d="M3 4v5h5"></path><path d="M12 7v5l3 2"></path>
    </svg>`;

  const enhanceAttachMenu = () => {
    document.querySelectorAll('#feature-chat .chat-input-row').forEach((row) => {
      if (row.dataset.zuvyrAttachMenu === '1') return;

      const input = row.querySelector('input[data-feature="chat"]');
      if (!input) return;

      row.dataset.zuvyrAttachMenu = '1';

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'zuvyr-attach-button';
      trigger.setAttribute('aria-label','Attach and ZUVYR tools');
      trigger.setAttribute('aria-expanded','false');
      trigger.title = 'Attach';
      trigger.innerHTML = plusIcon;

      const menu = document.createElement('div');
      menu.className = 'zuvyr-attach-menu';
      menu.setAttribute('aria-label','ZUVYR tools');
      menu.hidden = true;
      menu.innerHTML = `
        <div class="zuvyr-attach-brand">ZUVYR tools</div>
        <button type="button" class="zuvyr-attach-action" data-zuvyr-attach-action="recent">
          <span class="zuvyr-attach-action-icon">${historyIcon}</span>
          <span class="zuvyr-attach-action-copy">
            <span class="zuvyr-attach-action-title">Recent</span>
            <span class="zuvyr-attach-action-subtitle">Open your saved conversations</span>
          </span>
          <span class="zuvyr-attach-action-chevron" aria-hidden="true">â€º</span>
        </button>`;

      row.insertBefore(trigger,input);
      row.appendChild(menu);

      const setOpen = (open) => {
        menu.hidden = !open;
        trigger.setAttribute('aria-expanded',open ? 'true' : 'false');
      };

      trigger.addEventListener('click',(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOpen(menu.hidden);
      });

      menu.querySelector('[data-zuvyr-attach-action="recent"]').addEventListener('click',async () => {
        setOpen(false);
        const historyScreen = document.getElementById('feature-history');
        if (!historyScreen) {
          console.warn('ZUVYR history screen not found');
          return;
        }

        historyScreen.classList.add('active');

        if (typeof window.loadRoxHistory === 'function') {
          try {
            await window.loadRoxHistory();
          } catch (error) {
            console.warn('Unable to load ZUVYR history:',error);
          }
        }
      });

      document.addEventListener('pointerdown',(event) => {
        if (menu.hidden || menu.contains(event.target) || trigger.contains(event.target)) return;
        setOpen(false);
      });

      document.addEventListener('keydown',(event) => {
        if (event.key === 'Escape' && !menu.hidden) {
          setOpen(false);
          trigger.focus();
        }
      });
    });
  };

  enhanceAttachMenu();
  new MutationObserver(enhanceAttachMenu).observe(document.documentElement,{
    childList: true,
    subtree: true
  });
})();
