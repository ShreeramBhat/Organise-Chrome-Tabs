function clone(value) {
  return structuredClone(value);
}

export function createChromeMock(seed) {
  const state = {
    windows: new Map(),
    tabs: new Map(),
    groups: new Map(),
    storage: {},
    nextWindowId: 1,
    nextTabId: 1,
    nextGroupId: 1,
    onMessageListener: null,
    onActionClicked: null,
  };

  for (const sourceWindow of seed.windows) {
    const window = {
      id: sourceWindow.id,
      focused: Boolean(sourceWindow.focused),
      incognito: false,
      state: "normal",
      type: "normal",
    };
    state.windows.set(window.id, window);
    state.nextWindowId = Math.max(state.nextWindowId, window.id + 1);

    for (const sourceTab of sourceWindow.tabs) {
      const tab = {
        id: sourceTab.id,
        windowId: window.id,
        index: sourceTab.index,
        active: Boolean(sourceTab.active),
        pinned: Boolean(sourceTab.pinned),
        audible: false,
        discarded: false,
        groupId: sourceTab.groupId ?? -1,
        title: sourceTab.title,
        url: sourceTab.url,
        favIconUrl: "",
      };
      state.tabs.set(tab.id, tab);
      state.nextTabId = Math.max(state.nextTabId, tab.id + 1);
    }
  }

  function tabsInWindow(windowId) {
    return [...state.tabs.values()]
      .filter((tab) => tab.windowId === windowId)
      .sort((a, b) => a.index - b.index);
  }

  function normalizeIndexes(windowId) {
    tabsInWindow(windowId).forEach((tab, index) => {
      tab.index = index;
    });
  }

  function publicWindow(window, populate = false) {
    const result = clone(window);
    if (populate) result.tabs = tabsInWindow(window.id).map(clone);
    return result;
  }

  function cleanGroups() {
    for (const group of state.groups.values()) {
      const hasTabs = [...state.tabs.values()].some(
        (tab) => tab.groupId === group.id,
      );
      if (!hasTabs) state.groups.delete(group.id);
    }
  }

  function removeEmptyWindows() {
    for (const window of [...state.windows.values()]) {
      if (!tabsInWindow(window.id).length) {
        state.windows.delete(window.id);
      }
    }
  }

  function matchesUrl(pattern, url) {
    if (!pattern) return true;
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    return patterns.some((candidate) => {
      const escaped = candidate
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      return new RegExp(`^${escaped}$`).test(url);
    });
  }

  const chrome = {
    runtime: {
      getURL(path) {
        return `chrome-extension://test-extension/${path}`;
      },
      getManifest() {
        return { manifest_version: 3, name: "Tab Steward", version: "0.3.0" };
      },
      onMessage: {
        addListener(listener) {
          state.onMessageListener = listener;
        },
      },
    },
    action: {
      onClicked: {
        addListener(listener) {
          state.onActionClicked = listener;
        },
      },
    },
    storage: {
      local: {
        async get(key) {
          if (key === undefined) return clone(state.storage);
          if (typeof key === "string") {
            return key in state.storage ? { [key]: clone(state.storage[key]) } : {};
          }
          const keys = Array.isArray(key) ? key : Object.keys(key);
          return Object.fromEntries(
            keys
              .filter((candidate) => candidate in state.storage)
              .map((candidate) => [candidate, clone(state.storage[candidate])]),
          );
        },
        async set(values) {
          Object.assign(state.storage, clone(values));
        },
        async remove(key) {
          for (const candidate of Array.isArray(key) ? key : [key]) {
            delete state.storage[candidate];
          }
        },
      },
    },
    windows: {
      async getAll(options = {}) {
        return [...state.windows.values()].map((window) =>
          publicWindow(window, Boolean(options.populate)),
        );
      },
      async get(windowId, options = {}) {
        const window = state.windows.get(windowId);
        if (!window) throw new Error(`No window with id: ${windowId}.`);
        return publicWindow(window, Boolean(options.populate));
      },
      async create(createData = {}) {
        const id = state.nextWindowId++;
        if (createData.focused) {
          for (const window of state.windows.values()) window.focused = false;
        }
        const window = {
          id,
          focused: Boolean(createData.focused),
          incognito: false,
          state: "normal",
          type: "normal",
        };
        state.windows.set(id, window);
        const tab = {
          id: state.nextTabId++,
          windowId: id,
          index: 0,
          active: true,
          pinned: false,
          audible: false,
          discarded: false,
          groupId: -1,
          title: "New Tab",
          url: "chrome://newtab/",
          favIconUrl: "",
        };
        state.tabs.set(tab.id, tab);
        return publicWindow(window, true);
      },
      async update(windowId, updateInfo) {
        const window = state.windows.get(windowId);
        if (!window) throw new Error(`No window with id: ${windowId}.`);
        if (updateInfo.focused) {
          for (const candidate of state.windows.values()) {
            candidate.focused = candidate.id === windowId;
          }
        }
        Object.assign(window, updateInfo);
        return publicWindow(window, false);
      },
      async remove(windowId) {
        if (!state.windows.has(windowId)) {
          throw new Error(`No window with id: ${windowId}.`);
        }
        for (const tab of tabsInWindow(windowId)) state.tabs.delete(tab.id);
        state.windows.delete(windowId);
        cleanGroups();
      },
    },
    tabs: {
      async get(tabId) {
        const tab = state.tabs.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}.`);
        return clone(tab);
      },
      async query(queryInfo = {}) {
        return [...state.tabs.values()]
          .filter(
            (tab) =>
              (queryInfo.windowId === undefined ||
                tab.windowId === queryInfo.windowId) &&
              matchesUrl(queryInfo.url, tab.url),
          )
          .map(clone);
      },
      async create(createProperties = {}) {
        const windowId =
          createProperties.windowId ?? [...state.windows.keys()][0];
        if (!state.windows.has(windowId)) {
          throw new Error(`No window with id: ${windowId}.`);
        }
        const tab = {
          id: state.nextTabId++,
          windowId,
          index: tabsInWindow(windowId).length,
          active: Boolean(createProperties.active),
          pinned: Boolean(createProperties.pinned),
          audible: false,
          discarded: false,
          groupId: -1,
          title: createProperties.url || "New Tab",
          url: createProperties.url || "chrome://newtab/",
          favIconUrl: "",
        };
        if (tab.active) {
          for (const candidate of tabsInWindow(windowId)) candidate.active = false;
        }
        state.tabs.set(tab.id, tab);
        return clone(tab);
      },
      async update(tabId, updateProperties) {
        const tab = state.tabs.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}.`);
        if (updateProperties.active) {
          for (const candidate of tabsInWindow(tab.windowId)) {
            candidate.active = false;
          }
        }
        Object.assign(tab, updateProperties);
        return clone(tab);
      },
      async move(tabIds, moveProperties) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        const moving = ids.map((id) => {
          const tab = state.tabs.get(id);
          if (!tab) throw new Error(`No tab with id: ${id}.`);
          return tab;
        });
        if (!state.windows.has(moveProperties.windowId)) {
          throw new Error(`No window with id: ${moveProperties.windowId}.`);
        }
        const sourceWindowIds = new Set(moving.map((tab) => tab.windowId));
        const targetTabs = tabsInWindow(moveProperties.windowId).filter(
          (tab) => !ids.includes(tab.id),
        );
        let insertionIndex =
          moveProperties.index === -1
            ? targetTabs.length
            : Math.max(0, Math.min(moveProperties.index, targetTabs.length));

        for (const tab of moving) {
          tab.windowId = moveProperties.windowId;
          tab.index = insertionIndex++;
        }
        normalizeIndexes(moveProperties.windowId);
        for (const sourceWindowId of sourceWindowIds) {
          normalizeIndexes(sourceWindowId);
        }
        removeEmptyWindows();
        return Array.isArray(tabIds)
          ? moving.map(clone)
          : clone(moving[0]);
      },
      async remove(tabIds) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        const affectedWindows = new Set();
        for (const tabId of ids) {
          const tab = state.tabs.get(tabId);
          if (!tab) continue;
          affectedWindows.add(tab.windowId);
          state.tabs.delete(tabId);
        }
        for (const windowId of affectedWindows) normalizeIndexes(windowId);
        removeEmptyWindows();
        cleanGroups();
      },
      async ungroup(tabIds) {
        for (const tabId of Array.isArray(tabIds) ? tabIds : [tabIds]) {
          const tab = state.tabs.get(tabId);
          if (!tab) throw new Error(`No tab with id: ${tabId}.`);
          tab.groupId = -1;
        }
        cleanGroups();
      },
      async group(groupOptions) {
        const ids = Array.isArray(groupOptions.tabIds)
          ? groupOptions.tabIds
          : [groupOptions.tabIds];
        let groupId = groupOptions.groupId;
        if (groupId === undefined) {
          groupId = state.nextGroupId++;
          state.groups.set(groupId, {
            id: groupId,
            windowId: groupOptions.createProperties.windowId,
            title: "",
            color: "grey",
            collapsed: false,
          });
        }
        const group = state.groups.get(groupId);
        if (!group) throw new Error(`No group with id: ${groupId}.`);
        for (const tabId of ids) {
          const tab = state.tabs.get(tabId);
          if (!tab || tab.windowId !== group.windowId || tab.pinned) {
            throw new Error(`Tab ${tabId} cannot join group ${groupId}.`);
          }
          tab.groupId = groupId;
        }
        return groupId;
      },
    },
    tabGroups: {
      async query(queryInfo = {}) {
        return [...state.groups.values()]
          .filter(
            (group) =>
              (queryInfo.windowId === undefined ||
                group.windowId === queryInfo.windowId) &&
              (queryInfo.title === undefined ||
                group.title === queryInfo.title),
          )
          .map(clone);
      },
      async update(groupId, updateProperties) {
        const group = state.groups.get(groupId);
        if (!group) throw new Error(`No group with id: ${groupId}.`);
        Object.assign(group, updateProperties);
        return clone(group);
      },
    },
  };

  async function dispatch(message) {
    if (!state.onMessageListener) {
      throw new Error("The service worker did not register its message listener.");
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Timed out handling ${message.type}.`)),
        1000,
      );
      const keepAlive = state.onMessageListener(message, null, (response) => {
        clearTimeout(timeout);
        if (response.ok) resolve(response.result);
        else reject(new Error(response.error));
      });
      if (keepAlive !== true) {
        clearTimeout(timeout);
        reject(new Error(`${message.type} did not keep the response channel open.`));
      }
    });
  }

  return { chrome, state, dispatch };
}
