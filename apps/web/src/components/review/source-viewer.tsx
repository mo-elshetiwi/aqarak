"use client";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { useTranslations } from "next-intl";
import {
  FileText,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ReviewIconButton } from "./review-icon-button";
import type { ReviewDocument, SourceRegion } from "./types";

export interface SourceSelection {
  fieldId: string;
  label: string;
  descriptionId: string;
  region: SourceRegion | null;
  page: number;
  request: number;
}
export function SourceViewer({
  document,
  selection,
  qualityNote,
}: {
  document: ReviewDocument;
  selection: SourceSelection | null;
  qualityNote?: string | undefined;
}): ReactElement {
  const t = useTranslations("Review");
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const pages = useRef(new Map<number, HTMLElement>());
  const selectedPage = document.pages[pageIndex];
  const zoomBy = (amount: number): void => {
    setZoom((value) => Math.max(50, Math.min(200, value + amount)));
  };
  useEffect(() => {
    if (!selection) return;
    const page = pages.current.get(selection.page);
    (
      page?.querySelector("[data-testid=source-region]") ?? page
    )?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selection]);
  function movePage(offset: number): void {
    const next = Math.max(
      0,
      Math.min(document.pages.length - 1, pageIndex + offset),
    );
    setPageIndex(next);
    const page = document.pages[next];
    if (page)
      pages.current
        .get(page.number)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(25);
    }
    if (event.key === "-") {
      event.preventDefault();
      zoomBy(-25);
    }
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-48, 0],
      ArrowRight: [48, 0],
      ArrowUp: [0, -48],
      ArrowDown: [0, 48],
    };
    const delta = deltas[event.key];
    if (delta && viewport.current) {
      event.preventDefault();
      viewport.current.scrollBy({ left: delta[0], top: delta[1] });
    }
  }
  return (
    <section
      data-testid="source-viewer"
      className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card md:max-h-[76vh]"
      aria-label={t("sourcePane")}
    >
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <FileText aria-hidden="true" className="size-4 shrink-0" />
        <bdi className="min-w-0 flex-1 font-mono text-caption">
          {document.title}
        </bdi>
        {document.synthetic && (
          <span className="rounded-sm bg-muted ps-2 pe-2 py-1 text-caption">
            {t("synthetic")}
          </span>
        )}
        <span className="text-caption">
          {t("pageOf", {
            page: selectedPage?.number ?? 1,
            total: document.pages.length,
          })}
        </span>
        <TooltipProvider>
          <div className="flex flex-wrap items-center gap-1">
            <ReviewIconButton
              label={t("previousPage")}
              disabled={pageIndex === 0}
              onClick={() => {
                movePage(-1);
              }}
            >
              <ChevronLeft className="rtl:rotate-180" aria-hidden="true" />
            </ReviewIconButton>
            <ReviewIconButton
              label={t("nextPage")}
              disabled={pageIndex >= document.pages.length - 1}
              onClick={() => {
                movePage(1);
              }}
            >
              <ChevronRight className="rtl:rotate-180" aria-hidden="true" />
            </ReviewIconButton>
            <ReviewIconButton
              label={t("zoomOut")}
              disabled={zoom === 50}
              onClick={() => {
                zoomBy(-25);
              }}
            >
              <ZoomOut aria-hidden="true" />
            </ReviewIconButton>
            <ReviewIconButton
              label={t("zoomIn")}
              disabled={zoom === 200}
              onClick={() => {
                zoomBy(25);
              }}
            >
              <ZoomIn aria-hidden="true" />
            </ReviewIconButton>
            <ReviewIconButton
              label={t("resetView")}
              onClick={() => {
                setZoom(100);
                setRotation(0);
              }}
            >
              <RotateCcw aria-hidden="true" />
            </ReviewIconButton>
            <ReviewIconButton
              label={t("rotate")}
              onClick={() => {
                setRotation((value) => (value + 90) % 360);
              }}
            >
              <RotateCw aria-hidden="true" />
            </ReviewIconButton>
          </div>
        </TooltipProvider>
        <output
          aria-live="polite"
          className="text-caption tabular-nums"
          data-testid="zoom-level"
        >
          {t("zoomLevel", { zoom })}
        </output>
      </div>
      <div
        ref={viewport}
        role="region"
        tabIndex={0}
        aria-label={t("viewerLabel", { document: document.title })}
        onKeyDown={onKeyDown}
        onScroll={() => {
          const top = viewport.current?.getBoundingClientRect().top;
          if (top === undefined) return;
          const next = document.pages.findIndex(
            (page) =>
              (pages.current.get(page.number)?.getBoundingClientRect().bottom ??
                0) >
              top + 48,
          );
          if (next >= 0) setPageIndex(next);
        }}
        className="min-h-64 flex-1 overflow-auto bg-muted p-6 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
        dir="ltr"
      >
        {document.pages.map((page) => (
          <SourcePage
            key={page.number}
            page={page}
            zoom={zoom}
            rotation={rotation}
            selection={selection}
            synthetic={document.synthetic}
            register={(element) => {
              if (element) pages.current.set(page.number, element);
              else pages.current.delete(page.number);
            }}
          />
        ))}
      </div>
      {qualityNote && (
        <p className="border-t p-3 text-caption text-muted-foreground">
          {qualityNote}
        </p>
      )}
    </section>
  );
}
function SourcePage({
  page,
  zoom,
  rotation,
  selection,
  synthetic,
  register,
}: {
  page: ReviewDocument["pages"][number];
  zoom: number;
  rotation: number;
  selection: SourceSelection | null;
  synthetic: boolean;
  register: (element: HTMLElement | null) => void;
}): ReactElement {
  const t = useTranslations("Review");
  const [ratio, setRatio] = useState(2480 / 1560);
  const selected = selection?.page === page.number ? selection : null;
  const sideways = rotation % 180 !== 0;
  return (
    <figure
      ref={register}
      className="mb-6"
      style={{ width: `${String(zoom)}%` }}
    >
      <figcaption className="mb-2 text-caption text-foreground">
        {t("page", { page: page.number })}
        {selected && !selected.region && (
          <span
            data-testid="page-marker"
            aria-describedby={selected.descriptionId}
            className="ms-2 rounded-sm border-2 border-brand bg-card ps-2 pe-2"
          >
            {selected.label}
          </span>
        )}
      </figcaption>
      <div
        className="relative grid place-items-center"
        style={{ aspectRatio: sideways ? 1 / ratio : ratio }}
      >
        <div
          className="relative shrink-0"
          style={{
            width: sideways ? `${String(100 * ratio)}%` : "100%",
            transform: `rotate(${String(rotation)}deg)`,
          }}
        >
          <picture>
            <img
              src={page.imageSrc}
              alt={page.alt}
              width={2480}
              height={1560}
              className="block h-auto w-full"
              onLoad={(event) => {
                const image = event.currentTarget;
                if (image.naturalHeight)
                  setRatio(image.naturalWidth / image.naturalHeight);
              }}
            />
          </picture>
          {synthetic && (
            <span
              className="pointer-events-none absolute end-2 bg-card/90 ps-2 pe-2 py-1 text-caption-strong text-muted-foreground"
              style={{ insetBlockEnd: "2%" }}
            >
              {t("watermark")}
            </span>
          )}
          {selected?.region && (
            <span
              role="img"
              aria-label={t("sourceRegion", { field: selected.label })}
              aria-describedby={selected.descriptionId}
              data-testid="source-region"
              className="pointer-events-none absolute outline-2 outline-brand"
              style={{
                insetInlineStart: `${String(selected.region.x * 100)}%`,
                insetBlockStart: `${String(selected.region.y * 100)}%`,
                width: `${String(selected.region.width * 100)}%`,
                height: `${String(selected.region.height * 100)}%`,
              }}
            />
          )}
        </div>
      </div>
    </figure>
  );
}
