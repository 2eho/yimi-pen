import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSha256 } from "./snapshot-jcs.mjs";

const DEFAULT_PROFILE_PATH = "hardware/evt0/eda-system-skeleton-v1/profile.json";

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function stableId(prefix, value) {
  return `${prefix}:sha256:${canonicalSha256(value).sha256}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function endpointAtBoxBoundary(from, to) {
  const centerX = from.x + from.width / 2;
  const centerY = from.y + from.height / 2;
  const targetX = to.x + to.width / 2;
  const targetY = to.y + to.height / 2;
  const dx = targetX - centerX;
  const dy = targetY - centerY;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      x: dx >= 0 ? from.x + from.width : from.x,
      y: centerY,
    };
  }
  return {
    x: centerX,
    y: dy >= 0 ? from.y + from.height : from.y,
  };
}

function routeToEnclosure(from, to, edge) {
  const fromCenterX = from.x + from.width / 2;
  const enclosureCenterX = to.x + to.width / 2;
  if (edge.from.blockId === "TARGET-BOARD-ADAPTER") {
    const start = { x: fromCenterX, y: from.y + from.height };
    const end = { x: enclosureCenterX, y: to.y };
    return {
      points: [start, end],
      badge: { x: start.x, y: Math.round((start.y + end.y) / 2) },
    };
  }
  if (fromCenterX < to.x) {
    const policies = {
      "OID-HEAD": { corridorX: 570, laneY: to.y - 80, endX: to.x + 30 },
      "USB-DEVICE-PORT": { corridorX: 290, laneY: to.y - 60, endX: to.x + 80 },
      "USER-IO": { corridorX: 570, laneY: to.y - 40, endX: to.x + 180 },
    };
    const policy = policies[edge.from.blockId] ?? {
      corridorX: to.x - 30,
      laneY: to.y - 20,
      endX: to.x + 60,
    };
    const start = { x: fromCenterX, y: from.y + from.height };
    const end = { x: policy.endX, y: to.y };
    return {
      points: [
        start,
        { x: policy.corridorX, y: start.y },
        { x: policy.corridorX, y: policy.laneY },
        { x: end.x, y: policy.laneY },
        end,
      ],
      badge: {
        x: Math.round((policy.corridorX + end.x) / 2),
        y: policy.laneY,
      },
    };
  }
  const start = { x: fromCenterX, y: from.y + from.height };
  const end = { x: to.x + to.width, y: to.y + to.height / 2 };
  const corridorX = to.x + to.width + 130;
  return {
    points: [start, { x: corridorX, y: start.y }, { x: corridorX, y: end.y }, end],
    badge: { x: corridorX, y: Math.round((start.y + end.y) / 2) },
  };
}

function routeEdge(from, to, ordinal, edge) {
  if (edge.to.blockId === "ENCLOSURE") return routeToEnclosure(from, to, edge);
  const start = endpointAtBoxBoundary(from, to);
  const end = endpointAtBoxBoundary(to, from);
  const laneOffset = ((ordinal - 1) % 7 - 3) * 24;
  if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) {
    const low = Math.min(start.x, end.x);
    const high = Math.max(start.x, end.x);
    const midX = Math.round(Math.max(low + 12, Math.min(high - 12, (start.x + end.x) / 2 + laneOffset)));
    return {
      points: [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end],
      badge: { x: midX, y: Math.round((start.y + end.y) / 2) },
    };
  }
  const low = Math.min(start.y, end.y);
  const high = Math.max(start.y, end.y);
  const midY = Math.round(Math.max(low + 12, Math.min(high - 12, (start.y + end.y) / 2 + laneOffset)));
  return {
    points: [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end],
    badge: { x: Math.round((start.x + end.x) / 2), y: midY },
  };
}

function incidentInterfaces(topology, blockId) {
  return topology.interfaces.flatMap((item, index) => {
    if (item.from.blockId === blockId) {
      return [{ ordinal: index + 1, interfaceId: item.interfaceId, relation: "FROM", endpoint: item.from }];
    }
    if (item.to.blockId === blockId) {
      return [{ ordinal: index + 1, interfaceId: item.interfaceId, relation: "TO", endpoint: item.to }];
    }
    return [];
  });
}

export function buildLogicalSkeleton(profile, topology, targetBinding) {
  const placementByRole = new Map(
    profile.diagramLayout.rolePlacements.map((placement) => [placement.role, placement]),
  );
  const nodes = topology.blocks.map((block, index) => {
    const placement = placementByRole.get(block.role);
    if (!placement) throw new Error(`No logical preview placement for role ${block.role}`);
    return {
      nodeId: `N-${pad2(index + 1)}`,
      blockId: block.blockId,
      role: block.role,
      responsibility: block.responsibility,
      leafSheetRef: `SYS-${pad2(index + 1)}-${block.blockId}`,
      diagramPosition: {
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
      },
      ports: block.ports,
    };
  });
  const edges = topology.interfaces.map((item, index) => ({
    edgeId: `E-${pad2(index + 1)}`,
    interfaceId: item.interfaceId,
    kind: item.kind,
    from: item.from,
    to: item.to,
    semantic: item.semantic,
    requirements: item.requirements,
  }));
  const leafSheets = topology.blocks.map((block, index) => ({
    sheetId: `SYS-${pad2(index + 1)}-${block.blockId}`,
    blockId: block.blockId,
    role: block.role,
    responsibility: block.responsibility,
    ports: block.ports,
    incidentInterfaces: incidentInterfaces(topology, block.blockId),
  }));
  const withoutId = {
    schemaVersion: 1,
    profile: "eda-system-skeleton-plan-v1",
    mode: "VISUAL_ONLY",
    profileId: profile.profileId,
    sourceTopology: {
      path: profile.sources.topology.path,
      topologyId: topology.topologyId,
      bytes: profile.sources.topology.bytes,
      sha256: profile.sources.topology.sha256,
    },
    gateSnapshot: {
      targetState: targetBinding.targetIdentity.state,
      edaReadiness: targetBinding.eda.readiness,
      systemSkeletonReady: targetBinding.eda.systemSkeletonReady,
      chipLevelReady: targetBinding.eda.chipLevelReady,
    },
    hierarchy: {
      rootSheet: {
        sheetId: profile.hierarchy.rootSheetId,
        kind: "SYSTEM_OVERVIEW",
        nodes,
        edges,
      },
      leafSheets,
    },
    renderContract: {
      coordinateSystem: profile.diagramLayout.coordinateSystem,
      unit: profile.diagramLayout.unit,
      canvas: profile.diagramLayout.canvas,
      visualElementKinds: ["BLOCK_RECTANGLE", "GRAPHIC_POLYLINE", "TEXT_LABEL"],
      electricalSemantics: "NONE",
      physicalGeometrySemantics: "NONE",
    },
    locks: {
      permittedWork: targetBinding.eda.permittedWork,
      blockedWork: targetBinding.eda.blockedWork,
    },
    effects: profile.effects,
  };
  return { ...withoutId, skeletonId: stableId("edas", withoutId) };
}

function interfaceRegisterText(edge) {
  return `${edge.edgeId} ${edge.interfaceId} [${edge.kind}] ${edge.from.blockId}/${edge.from.portId} -> ${edge.to.blockId}/${edge.to.portId}`;
}

export function buildWritePlan(profile, skeleton) {
  const nodes = skeleton.hierarchy.rootSheet.nodes;
  const edges = skeleton.hierarchy.rootSheet.edges;
  const withoutId = {
    schemaVersion: 1,
    artifactKind: "JLCEDA_SYSTEM_SKELETON_WRITE_PLAN_V1",
    status: "UNEXECUTED",
    executionMode: profile.scope.executionMode,
    sourceSkeleton: {
      skeletonId: skeleton.skeletonId,
      topologyId: skeleton.sourceTopology.topologyId,
    },
    executionIdentity: {
      projectUuid: null,
      projectRevision: null,
      schematicUuid: null,
      overviewPageUuid: null,
      interfaceRegisterPageUuid: null,
    },
    nativeSourceGenerated: false,
    nativeExportGenerated: false,
    prerequisites: profile.applyPolicy.prerequisites,
    futurePageIntents: [
      {
        pageIntentId: "SYSTEM-OVERVIEW",
        logicalSheetRef: skeleton.hierarchy.rootSheet.sheetId,
        purpose: "Create one non-electrical visual overview using rectangles and text only.",
        rectangleIntents: nodes.map((node) => ({
          blockId: node.blockId,
          visualPlacementRef: node.nodeId,
          coordinateMapping: "APPLICATOR_OWNED_VERSIONED_STYLE",
        })),
        textIntents: nodes.flatMap((node) => [
          { textClass: "BLOCK_ID", sourceRef: node.blockId, value: node.blockId },
          { textClass: "BLOCK_ROLE", sourceRef: node.blockId, value: node.role },
        ]),
      },
      {
        pageIntentId: "INTERFACE-REGISTER",
        logicalSheetRef: "SYS-IF-REGISTER",
        purpose: "List logical interface identities and endpoints as text; create no EDA wire or bus.",
        rectangleIntents: [],
        textIntents: edges.map((edge) => ({
          textClass: "LOGICAL_INTERFACE_REGISTER_ROW",
          sourceRef: edge.interfaceId,
          value: interfaceRegisterText(edge),
        })),
      },
      ...skeleton.hierarchy.leafSheets.map((sheet) => ({
        pageIntentId: `LEAF-${sheet.blockId}`,
        logicalSheetRef: sheet.sheetId,
        purpose: "Present one topology block, its logical ports, and incident interface labels without implementation detail.",
        rectangleIntents: [{
          blockId: sheet.blockId,
          visualPlacementRef: "LEAF_PRIMARY_BLOCK_FRAME",
          coordinateMapping: "APPLICATOR_OWNED_VERSIONED_STYLE",
        }],
        textIntents: [
          { textClass: "BLOCK_ID", sourceRef: sheet.blockId, value: sheet.blockId },
          { textClass: "BLOCK_ROLE", sourceRef: sheet.blockId, value: sheet.role },
          ...sheet.ports.map((port) => ({
            textClass: "LOGICAL_PORT",
            sourceRef: `${sheet.blockId}/${port.portId}`,
            value: `${port.portId} [${port.direction}]`,
          })),
          ...sheet.incidentInterfaces.map((item) => ({
            textClass: "LOGICAL_INTERFACE_LABEL",
            sourceRef: item.interfaceId,
            value: `${item.interfaceId} [${item.relation}]`,
          })),
        ],
      })),
    ],
    officialApiSequence: [
      {
        sequence: 1,
        action: "READ_PROJECT_CONTEXT",
        method: "eda.dmt_Project.getCurrentProjectInfo",
        stability: "PINNED_OFFICIAL_API",
        mutatesDesign: false,
      },
      {
        sequence: 2,
        action: "READ_DOCUMENT_CONTEXT",
        method: "eda.dmt_SelectControl.getCurrentDocumentInfo",
        stability: "PINNED_OFFICIAL_API",
        mutatesDesign: false,
      },
      {
        sequence: 3,
        action: "CREATE_ISOLATED_SCHEMATIC",
        method: "eda.dmt_Schematic.createSchematic",
        stability: "BETA_OFFICIAL_API",
        mutatesDesign: true,
      },
      {
        sequence: 4,
        action: "CREATE_PAGE_SET",
        method: "eda.dmt_Schematic.createSchematicPage",
        stability: "BETA_OFFICIAL_API",
        mutatesDesign: true,
      },
      {
        sequence: 5,
        action: "CREATE_BLOCK_RECTANGLES",
        method: "eda.sch_PrimitiveRectangle.create",
        stability: "PINNED_OFFICIAL_API",
        mutatesDesign: true,
      },
      {
        sequence: 6,
        action: "CREATE_LABEL_TEXT",
        method: "eda.sch_PrimitiveText.create",
        stability: "BETA_OFFICIAL_API",
        mutatesDesign: true,
      },
      {
        sequence: 7,
        action: "SAVE_DOCUMENT",
        method: "eda.sch_Document.save",
        stability: "PINNED_OFFICIAL_API",
        mutatesDesign: true,
      },
      {
        sequence: 8,
        action: "READ_BACK_PRIMITIVE_COUNTS",
        method: "eda.sch_PrimitiveRectangle.getAll + eda.sch_PrimitiveText.getAll",
        stability: "MIXED_PINNED_AND_BETA_OFFICIAL_API",
        mutatesDesign: false,
      },
      {
        sequence: 9,
        action: "EXPORT_REVIEW_DOCUMENT",
        method: "eda.sch_ManufactureData.getExportDocumentFile",
        stability: "BETA_OFFICIAL_API",
        mutatesDesign: false,
      },
    ],
    interfacePolicy: {
      previewRendering: "GRAPHIC_POLYLINE_WITHOUT_ARROWHEAD",
      futureEdaRendering: profile.applyPolicy.interfaceRendering,
      allowedFuturePrimitiveKinds: profile.applyPolicy.permittedFuturePrimitives,
      edaWireCount: 0,
      edaBusCount: 0,
    },
    acceptanceEvidence: [
      "captured pre-write project snapshot identity",
      "captured native project/document/page identities",
      "rectangle and text readback counts match this plan",
      "official SVG or PDF export bytes and SHA-256 recorded",
      "post-write project snapshot and rollback evidence recorded",
    ],
    effects: profile.effects,
  };
  return { ...withoutId, writePlanId: stableId("edawp", withoutId) };
}

export function renderSystemOverviewSvg(profile, skeleton, writePlan) {
  const { width, height } = profile.diagramLayout.canvas;
  const nodes = skeleton.hierarchy.rootSheet.nodes;
  const edges = skeleton.hierarchy.rootSheet.edges;
  const nodeById = new Map(nodes.map((node) => [node.blockId, node]));
  const lineParts = [];
  const badgeParts = [];
  for (const [index, edge] of edges.entries()) {
    const from = nodeById.get(edge.from.blockId).diagramPosition;
    const to = nodeById.get(edge.to.blockId).diagramPosition;
    const route = routeEdge(from, to, index + 1, edge);
    const points = route.points.map((point) => `${point.x},${point.y}`).join(" ");
    const peripheral = ["MECHANICAL", "ACOUSTIC", "OPTICAL"].includes(edge.kind);
    lineParts.push(
      `    <polyline id="interface-${escapeXml(edge.interfaceId)}" class="interface ${peripheral ? "peripheral" : "internal"}" points="${points}"><title>${escapeXml(interfaceRegisterText(edge))}: ${escapeXml(edge.semantic)}</title></polyline>`,
    );
    badgeParts.push(
      `    <g class="edge-badge" transform="translate(${route.badge.x} ${route.badge.y})"><circle r="11"/><text y="3">${pad2(index + 1)}</text></g>`,
    );
  }
  const nodeParts = nodes.map((node) => {
    const p = node.diagramPosition;
    const titleY = p.y + 34;
    const roleY = p.y + 60;
    const sheetY = p.y + p.height - 14;
    return [
      `    <g id="block-${escapeXml(node.blockId)}" class="block">`,
      `      <rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" rx="12"/>`,
      `      <text class="block-id" x="${p.x + p.width / 2}" y="${titleY}">${escapeXml(node.blockId)}</text>`,
      `      <text class="block-role" x="${p.x + p.width / 2}" y="${roleY}">${escapeXml(node.role)}</text>`,
      `      <text class="sheet-ref" x="${p.x + p.width / 2}" y="${sheetY}">${escapeXml(node.leafSheetRef)} · ${node.ports.length} logical ports</text>`,
      `      <title>${escapeXml(node.responsibility)}</title>`,
      "    </g>",
    ].join("\n");
  });
  const legendX = 1430;
  const legendParts = edges.map((edge, index) => {
    const y = 132 + index * 48;
    return [
      `    <g id="legend-${escapeXml(edge.interfaceId)}" class="legend-row">`,
      `      <circle cx="${legendX}" cy="${y - 5}" r="13"/><text class="legend-index" x="${legendX}" y="${y - 1}">${pad2(index + 1)}</text>`,
      `      <text class="legend-id" x="${legendX + 24}" y="${y - 4}">${escapeXml(edge.interfaceId)}</text>`,
      `      <text class="legend-kind" x="${legendX + 24}" y="${y + 14}">${escapeXml(edge.kind)} · logical contract</text>`,
      "    </g>",
    ].join("\n");
  });
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
    `  <title id="title">Yimi Pen Gen1 logical hardware system skeleton</title>`,
    `  <desc id="desc">Twelve stable logical blocks and eighteen logical interfaces. This is a visual-only preview without circuit or physical geometry semantics.</desc>`,
    `  <metadata>${escapeXml(JSON.stringify({ skeletonId: skeleton.skeletonId, writePlanId: writePlan.writePlanId, topologyId: skeleton.sourceTopology.topologyId }))}</metadata>`,
    "  <style>",
    "    .page { fill: #f5f7fb; }",
    "    .frame { fill: #ffffff; stroke: #c9d4e5; stroke-width: 2; }",
    "    .block rect { fill: #ffffff; stroke: #1457a6; stroke-width: 2.5; }",
    "    .block-id { font: 700 16px system-ui, sans-serif; text-anchor: middle; fill: #12345b; }",
    "    .block-role { font: 12px ui-monospace, monospace; text-anchor: middle; fill: #4d6380; }",
    "    .sheet-ref { font: 11px system-ui, sans-serif; text-anchor: middle; fill: #6f8097; }",
    "    .interface { fill: none; stroke: #6886aa; stroke-width: 2; stroke-linejoin: round; }",
    "    .interface.peripheral { stroke: #9b6b2f; stroke-dasharray: 7 5; }",
    "    .edge-badge circle, .legend-row circle { fill: #12345b; stroke: #ffffff; stroke-width: 2; }",
    "    .edge-badge text, .legend-index { font: 700 10px system-ui, sans-serif; text-anchor: middle; fill: #ffffff; }",
    "    .header { font: 700 27px system-ui, sans-serif; fill: #102b4e; }",
    "    .subheader { font: 14px system-ui, sans-serif; fill: #4e6480; }",
    "    .legend-title { font: 700 18px system-ui, sans-serif; fill: #102b4e; }",
    "    .legend-id { font: 700 13px ui-monospace, monospace; fill: #1f4778; }",
    "    .legend-kind { font: 11px system-ui, sans-serif; fill: #687b92; }",
    "    .footer { font: 12px system-ui, sans-serif; fill: #66778d; }",
    "  </style>",
    `  <rect class="page" width="${width}" height="${height}"/>`,
    `  <rect class="frame" x="20" y="20" width="${width - 40}" height="${height - 40}" rx="18"/>`,
    '  <text class="header" x="48" y="62">Yimi Pen Gen1 · Logical Hardware System Skeleton</text>',
    `  <text class="subheader" x="48" y="88">${escapeXml(skeleton.sourceTopology.topologyId)} · ${nodes.length} blocks · ${edges.length} interfaces · BOARD_TARGET=UNRESOLVED</text>`,
    '  <text class="subheader" x="48" y="108">Visual-only: interface lines are graphics, not EDA wires; preview coordinates have no physical meaning.</text>',
    `  <line x1="1395" y1="96" x2="1395" y2="${height - 70}" stroke="#d5deeb" stroke-width="2"/>`,
    '  <text class="legend-title" x="1420" y="88">Interface register</text>',
    '  <g id="interfaces">',
    ...lineParts,
    "  </g>",
    '  <g id="blocks">',
    ...nodeParts,
    "  </g>",
    '  <g id="interface-badges">',
    ...badgeParts,
    "  </g>",
    '  <g id="interface-register">',
    ...legendParts,
    "  </g>",
    `  <text class="footer" x="48" y="${height - 42}">Permitted: hierarchy · block diagram · interface labels. Symbols, pins, rail values, connectors, PCB layout and manufacturing remain locked.</text>`,
    "</svg>",
    "",
  ].join("\n");
}

export async function loadSkeletonInputs(root, profileRelative = DEFAULT_PROFILE_PATH) {
  const profile = JSON.parse(await readFile(path.join(root, profileRelative), "utf8"));
  const [topology, targetBinding] = await Promise.all([
    readFile(path.join(root, profile.sources.topology.path), "utf8").then(JSON.parse),
    readFile(path.join(root, profile.sources.targetBinding.path), "utf8").then(JSON.parse),
  ]);
  return { profile, topology, targetBinding };
}

export function buildArtifactSet(profile, topology, targetBinding) {
  const logicalSkeleton = buildLogicalSkeleton(profile, topology, targetBinding);
  const writePlan = buildWritePlan(profile, logicalSkeleton);
  const files = {
    [profile.outputs.logicalSkeleton]: `${JSON.stringify(logicalSkeleton, null, 2)}\n`,
    [profile.outputs.writePlan]: `${JSON.stringify(writePlan, null, 2)}\n`,
    [profile.outputs.preview]: renderSystemOverviewSvg(profile, logicalSkeleton, writePlan),
  };
  return {
    logicalSkeleton,
    writePlan,
    files,
    identities: Object.entries(files).map(([relativePath, content]) => ({
      path: relativePath,
      bytes: Buffer.byteLength(content, "utf8"),
      sha256: sha256Text(content),
    })),
  };
}

function assertOutputPath(root, relativePath) {
  const expectedRoot = path.resolve(root, "build/eda-system-skeleton-v1");
  const outputPath = path.resolve(root, relativePath);
  if (outputPath !== expectedRoot && !outputPath.startsWith(`${expectedRoot}${path.sep}`)) {
    throw new Error(`Output path escapes build/eda-system-skeleton-v1: ${relativePath}`);
  }
  return outputPath;
}

export async function writeArtifactSet(root, artifactSet) {
  for (const [relativePath, content] of Object.entries(artifactSet.files)) {
    const outputPath = assertOutputPath(root, relativePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, "utf8");
  }
}

export async function checkArtifactSet(root, artifactSet) {
  const mismatches = [];
  for (const [relativePath, expected] of Object.entries(artifactSet.files)) {
    const outputPath = assertOutputPath(root, relativePath);
    let actual;
    try {
      actual = await readFile(outputPath, "utf8");
    } catch (error) {
      mismatches.push(`${relativePath}: ${error.code ?? error.message}`);
      continue;
    }
    if (actual !== expected) mismatches.push(`${relativePath}: generated bytes differ`);
  }
  return mismatches;
}

async function main() {
  const root = process.cwd();
  const mode = process.argv.includes("--check") ? "check" : "write";
  const { profile, topology, targetBinding } = await loadSkeletonInputs(root);
  const artifactSet = buildArtifactSet(profile, topology, targetBinding);
  if (mode === "write") {
    await writeArtifactSet(root, artifactSet);
  } else {
    const mismatches = await checkArtifactSet(root, artifactSet);
    if (mismatches.length > 0) throw new Error(`EDA skeleton outputs are stale:\n${mismatches.join("\n")}`);
  }
  process.stdout.write(
    `EDA system skeleton ${mode}: ${artifactSet.logicalSkeleton.hierarchy.rootSheet.nodes.length} blocks, ` +
      `${artifactSet.logicalSkeleton.hierarchy.rootSheet.edges.length} interfaces, ` +
      `${artifactSet.identities.length} artifacts\n`,
  );
  for (const identity of artifactSet.identities) {
    process.stdout.write(`  ${identity.path} ${identity.bytes} bytes sha256=${identity.sha256}\n`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
