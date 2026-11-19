/* Interakcje na płótnie: zaznaczanie, przesuwanie, łączenie, pan, zoom */
import {
  GRID,
  connectionExists,
  instanceBounds,
  instanceHeight,
  isStretchable,
  parseEndpoint,
  portWorld,
  snapValue
} from './model.js';
import { isEditableTarget, uid } from './utils.js';

function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function initCanvas({ store, svg, wrap, statusCoords, toast, onDropDefinition, onOpenFile }) {
  let spaceDown = false;
  let action = null;
  let lastWorld = { x: 0, y: 0 };

  const rectOf = () => svg.getBoundingClientRect();

  function toWorld(clientX, clientY) {
    const rect = rectOf();
    return {
      x: (clientX - rect.left - store.camera.x) / store.camera.k,
      y: (clientY - rect.top - store.camera.y) / store.camera.k
    };
  }

  function updateCoords(world) {
    lastWorld = world;
    if (statusCoords) {
      statusCoords.textContent = `X ${Math.round(world.x)} · Y ${Math.round(world.y)}`;
    }
  }

  function capture(event) {
    try { svg.setPointerCapture(event.pointerId); } catch { /* ignore */ }
  }

  function release(event) {
    try {
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    } catch { /* ignore */ }
  }

  function clearTransient() {
    store.transient = {};
    store.emit('transient');
  }

  /* ---------------- pointer down ---------------- */
  svg.addEventListener('pointerdown', (event) => {
    const world = toWorld(event.clientX, event.clientY);
    updateCoords(world);

    if (event.button === 1 || (event.button === 0 && (spaceDown || store.settings.tool === 'pan'))) {
      event.preventDefault();
      capture(event);
      action = {
        type: 'pan',
        pointerId: event.pointerId,
        startScreen: { x: event.clientX, y: event.clientY },
        startCamera: { ...store.camera }
      };
      svg.classList.add('is-panning');
      return;
    }
    if (event.button !== 0) return;

    const resizeEl = event.target.closest?.('[data-resize]');
    if (resizeEl) {
      event.preventDefault();
      capture(event);
      const instanceId = resizeEl.dataset.resize;
      const inst = store.instanceById(instanceId);
      const def = inst && store.doc.definitions[inst.type];
      if (!inst || !isStretchable(def)) return;
      store.selectInstances([instanceId]);
      store.beginTransaction();
      const rad = (Number(inst.rot || 0) * Math.PI) / 180;
      action = {
        type: 'resize',
        pointerId: event.pointerId,
        instanceId,
        startWorld: world,
        startHeight: instanceHeight(inst, def),
        min: def.stretch.min,
        max: def.stretch.max,
        cos: Math.cos(rad),
        sin: Math.sin(rad)
      };
      return;
    }

    const portEl = event.target.closest?.('[data-port]');
    if (portEl) {
      event.preventDefault();
      capture(event);
      const instanceId = portEl.dataset.instance;
      const portId = portEl.dataset.port;
      const endpoint = `${instanceId}.${portId}`;
      const resolved = portWorld(store.doc, instanceId, portId);
      if (!resolved) return;
      action = {
        type: 'connect',
        pointerId: event.pointerId,
        from: { instanceId, portId },
        endpoint,
        medium: resolved.port.type
      };
      store.transient = {
        wirePreview: {
          from: action.from,
          to: world,
          medium: resolved.port.type
        }
      };
      store.emit('transient');
      return;
    }

    const instanceEl = event.target.closest?.('[data-instance]');
    if (instanceEl) {
      event.preventDefault();
      capture(event);
      const id = instanceEl.dataset.instance;
      const wasSelected = store.isSelected(id);
      if (event.shiftKey) {
        store.selectInstances([id], { additive: true });
      } else if (!wasSelected) {
        store.selectInstances([id]);
      }
      const ids = store.selection.instances.includes(id)
        ? store.selection.instances
        : [id];
      const items = ids
        .map((instanceId) => {
          const inst = store.instanceById(instanceId);
          return inst ? { inst, startX: inst.x, startY: inst.y } : null;
        })
        .filter(Boolean);
      store.beginTransaction();
      action = {
        type: 'drag',
        pointerId: event.pointerId,
        startWorld: world,
        items,
        clickedId: id,
        shift: event.shiftKey,
        wasSelected,
        moved: false
      };
      return;
    }

    const connectionEl = event.target.closest?.('[data-connection]');
    if (connectionEl) {
      event.preventDefault();
      store.selectConnection(connectionEl.dataset.connection, { additive: event.shiftKey });
      return;
    }

    /* puste tło — gumka z zaznaczeniem */
    event.preventDefault();
    capture(event);
    if (!event.shiftKey) store.clearSelection();
    action = {
      type: 'marquee',
      pointerId: event.pointerId,
      startWorld: world,
      additive: event.shiftKey
    };
    store.transient = { marquee: { x: world.x, y: world.y, w: 0, h: 0 } };
  });

  /* ---------------- pointer move ---------------- */
  svg.addEventListener('pointermove', (event) => {
    const world = toWorld(event.clientX, event.clientY);
    updateCoords(world);

    if (!action) return;

    if (action.type === 'pan') {
      const dx = event.clientX - action.startScreen.x;
      const dy = event.clientY - action.startScreen.y;
      store.camera = {
        k: action.startCamera.k,
        x: action.startCamera.x + dx,
        y: action.startCamera.y + dy
      };
      store.emit('camera');
      return;
    }

    if (action.type === 'drag') {
      const dx = world.x - action.startWorld.x;
      const dy = world.y - action.startWorld.y;
      if (!action.moved && Math.hypot(dx, dy) * store.camera.k > 3) action.moved = true;
      const grid = store.settings.snap ? GRID : 0;
      for (const item of action.items) {
        item.inst.x = grid ? snapValue(item.startX + dx, true, grid) : item.startX + dx;
        item.inst.y = grid ? snapValue(item.startY + dy, true, grid) : item.startY + dy;
      }
      store.emit('doc-live');
      return;
    }

    if (action.type === 'connect') {
      const preview = store.transient.wirePreview;
      if (!preview) return;
      preview.to = world;
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const targetPort = element?.closest?.('[data-port]');
      let target = null;
      if (targetPort) {
        const instanceId = targetPort.dataset.instance;
        const portId = targetPort.dataset.port;
        if (`${instanceId}.${portId}` !== action.endpoint) {
          target = { instanceId, portId };
        }
      }
      store.transient.connectTarget = target;
      store.emit('transient');
      return;
    }

    if (action.type === 'resize') {
      const inst = store.instanceById(action.instanceId);
      if (!inst) return;
      const dx = world.x - action.startWorld.x;
      const dy = world.y - action.startWorld.y;
      const localDy = -dx * action.sin + dy * action.cos;
      const grid = store.settings.snap ? GRID : 0;
      let height = action.startHeight + localDy;
      if (grid) height = snapValue(height, true, grid);
      inst.h = Math.min(action.max, Math.max(action.min, height));
      store.emit('doc-live');
      return;
    }

    if (action.type === 'marquee') {
      const x = Math.min(action.startWorld.x, world.x);
      const y = Math.min(action.startWorld.y, world.y);
      const w = Math.abs(world.x - action.startWorld.x);
      const h = Math.abs(world.y - action.startWorld.y);
      store.transient = { marquee: { x, y, w, h } };
      store.emit('transient');
    }
  });

  /* ---------------- pointer up ---------------- */
  svg.addEventListener('pointerup', (event) => {
    const current = action;
    action = null;
    svg.classList.remove('is-panning');
    if (!current) return;
    release(event);

    if (current.type === 'drag') {
      if (!current.moved && !current.shift && current.wasSelected && store.selection.instances.length > 1) {
        store.selectInstances([current.clickedId]);
      }
      store.commitTransaction('Przesunięcie elementów');
      return;
    }

    if (current.type === 'connect') {
      const target = store.transient.connectTarget;
      const preview = store.transient.wirePreview;
      if (target) {
        finishConnection(current, target);
      } else if (preview) {
        /* brak celu — po prostu anuluj */
      }
      clearTransient();
      return;
    }

    if (current.type === 'resize') {
      store.commitTransaction('Zmieniono wysokość elementu');
      return;
    }

    if (current.type === 'marquee') {
      const marquee = store.transient.marquee;
      const selected = [];
      if (marquee && (marquee.w > 2 || marquee.h > 2)) {
        for (const inst of store.doc.instances) {
          const def = store.doc.definitions[inst.type];
          if (!def) continue;
          const bounds = instanceBounds(inst, def);
          if (intersects(bounds, marquee)) selected.push(inst.id);
        }
        if (current.additive) {
          store.selectInstances(selected, { additive: true });
        } else {
          store.selectInstances(selected);
        }
      }
      clearTransient();
    }
  });

  svg.addEventListener('pointercancel', (event) => {
    if (action?.type === 'drag' || action?.type === 'resize') store.cancelTransaction();
    action = null;
    svg.classList.remove('is-panning');
    clearTransient();
    release(event);
  });

  function finishConnection(current, target) {
    const fromResolved = portWorld(store.doc, current.from.instanceId, current.from.portId);
    const toResolved = portWorld(store.doc, target.instanceId, target.portId);
    if (!fromResolved || !toResolved) return;

    if (fromResolved.port.type !== toResolved.port.type &&
        fromResolved.port.type !== 'other' && toResolved.port.type !== 'other') {
      toast?.('Porty mają różne media — połączenie nie zostało utworzone.', 'error');
      return;
    }

    const from = `${current.from.instanceId}.${current.from.portId}`;
    const to = `${target.instanceId}.${target.portId}`;
    if (connectionExists(store.doc, from, to)) {
      toast?.('Takie połączenie już istnieje.', 'error');
      return;
    }

    const medium = fromResolved.port.type === 'other' ? toResolved.port.type : fromResolved.port.type;
    store.change('Dodano połączenie', (doc) => {
      doc.connections.push({
        id: uid('c'),
        from,
        to,
        medium,
        label: ''
      });
    });
    toast?.('Dodano połączenie.', 'ok');
  }

  /* ---------------- wheel zoom ---------------- */
  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = rectOf();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const factor = Math.exp(-event.deltaY * 0.0015);
    store.zoomAt(sx, sy, factor);
  }, { passive: false });

  /* ---------------- dwuklik: edycja etykiety ---------------- */
  svg.addEventListener('dblclick', (event) => {
    if (store.settings.tool === 'pan') return;
    const instanceEl = event.target.closest?.('[data-instance]');
    if (!instanceEl) return;
    store.selectInstances([instanceEl.dataset.instance]);
    store.emit('focus-label');
  });

  /* ---------------- drag & drop z biblioteki ---------------- */
  let dragDepth = 0;
  wrap.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer) return;
    dragDepth++;
    wrap.classList.add('is-dragover');
  });
  wrap.addEventListener('dragover', (event) => {
    if (event.dataTransfer) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  });
  wrap.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) wrap.classList.remove('is-dragover');
  });
  wrap.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    wrap.classList.remove('is-dragover');
    const world = toWorld(event.clientX, event.clientY);

    if (event.dataTransfer?.files?.length) {
      const file = event.dataTransfer.files[0];
      if (file && /\.json$/i.test(file.name)) {
        onOpenFile?.(file);
      }
      return;
    }
    const key = event.dataTransfer?.getData('application/x-schematic-def') ||
      event.dataTransfer?.getData('text/plain');
    if (key) onDropDefinition?.(key.trim(), world);
  });

  wrap.addEventListener('contextmenu', (event) => {
    if (event.target.closest?.('#canvas')) event.preventDefault();
  });

  /* ---------------- rozmiar / skróty ---------------- */
  const resizeObserver = new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect;
    if (box) {
      store.setViewport(box.width, box.height);
      if (!resizeObserver.didFit) {
        resizeObserver.didFit = true;
        requestAnimationFrame(() => store.fitView());
      }
    }
  });
  resizeObserver.observe(wrap);

  const onKeyDown = (event) => {
    if (document.getElementById('modal-root')?.children.length) return;
    if (event.code === 'Space' && !isEditableTarget(event.target)) {
      if (!spaceDown) {
        spaceDown = true;
        svg.classList.add('is-space');
      }
      event.preventDefault();
    }
  };
  const onKeyUp = (event) => {
    if (event.code === 'Space') {
      spaceDown = false;
      svg.classList.remove('is-space');
    }
  };
  const onBlur = () => {
    spaceDown = false;
    svg.classList.remove('is-space');
  };
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  /* ---------------- narzędzie: zaznaczanie / przesuwanie ---------------- */
  const syncTool = () => {
    svg.classList.toggle('is-pan-tool', store.settings.tool === 'pan');
  };
  const offStore = store.on((reason) => {
    if (reason === 'settings') syncTool();
  });
  syncTool();

  return {
    getLastWorld: () => lastWorld,
    destroy() {
      resizeObserver.disconnect();
      offStore();
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    }
  };
}
