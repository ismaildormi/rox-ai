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
