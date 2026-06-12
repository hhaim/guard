import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { buildPlanReportHtml, planReportPdfFilename, type PlanReportInput } from "./planReportHtml";

/** ~A4 landscape content width at 96dpi */
const SHEET_WIDTH_PX = 1122;
const CANVAS_SCALE = 2;
const PAGE_SELECTOR = ".pdf-cover, .pdf-page";
const PDF_MARGIN_MM = 6;

function waitForLayout(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function applyPrintColors(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("*").forEach((el) => {
    el.style.setProperty("print-color-adjust", "exact");
    el.style.setProperty("-webkit-print-color-adjust", "exact");
  });
}

function loadReportDocument(iframe: HTMLIFrameElement, html: string): Promise<Document> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("PDF export timed out while rendering the report."));
    }, 60_000);

    iframe.onload = () => {
      void (async () => {
        try {
          const doc = iframe.contentDocument;
          if (!doc?.body?.innerHTML.trim()) {
            reject(new Error("Report content is empty."));
            return;
          }
          const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 800);
          iframe.style.height = `${h}px`;
          await waitForLayout();
          resolve(doc);
        } catch (e) {
          reject(e);
        } finally {
          window.clearTimeout(timeout);
        }
      })();
    };

    iframe.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("Failed to render report for PDF export."));
    };

    iframe.srcdoc = html;
  });
}

function createReportIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Plan PDF export");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    `width:${SHEET_WIDTH_PX}px`,
    "height:800px",
    "border:0",
    "margin:0",
    "padding:0",
    "overflow:visible",
    "opacity:0.01",
    "pointer-events:none",
    "z-index:-1",
    "background:#fff",
  ].join(";");
  return iframe;
}

function fitImageDimensions(
  canvasW: number,
  canvasH: number,
  maxW: number,
  maxH: number
): { w: number; h: number } {
  const ratio = canvasW / canvasH;
  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return { w, h };
}

async function captureElement(el: HTMLElement): Promise<HTMLCanvasElement> {
  el.scrollIntoView({ block: "start", inline: "nearest" });
  await waitForLayout();
  return html2canvas(el, {
    scale: CANVAS_SCALE,
    backgroundColor: "#ffffff",
    logging: false,
    useCORS: true,
    width: el.scrollWidth,
    height: el.scrollHeight,
    windowWidth: el.scrollWidth,
    scrollX: 0,
    scrollY: 0,
    onclone: (clonedDoc) => {
      applyPrintColors(clonedDoc);
    },
  });
}

/** Render each .pdf-page / .pdf-cover block into its own PDF page (reliable vs whole-document html2pdf). */
async function saveReportPdf(doc: Document, filename: string): Promise<void> {
  const sheets = Array.from(doc.querySelectorAll<HTMLElement>(PAGE_SELECTOR));
  if (!sheets.length) {
    throw new Error("Report has no pages to export.");
  }

  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const maxW = pageW - 2 * PDF_MARGIN_MM;
  const maxH = pageH - 2 * PDF_MARGIN_MM;

  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    const canvas = await captureElement(sheet);
    const img = canvas.toDataURL("image/jpeg", 0.92);
    const { w, h } = fitImageDimensions(canvas.width, canvas.height, maxW, maxH);
    const x = PDF_MARGIN_MM + (maxW - w) / 2;
    const y = PDF_MARGIN_MM;

    if (i > 0) {
      pdf.addPage("a4", "landscape");
    }
    pdf.addImage(img, "JPEG", x, y, w, h, undefined, "FAST");
  }

  pdf.save(filename);
}

/** Print dialog fallback (Save as PDF) — respects CSS page breaks. */
export function printPlanReportPdf(html: string, filename: string): void {
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) {
    throw new Error("Pop-up blocked. Allow pop-ups for this site to export PDF.");
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.document.title = filename.replace(/\.pdf$/i, "");
  w.focus();
  const trigger = () => {
    w.print();
    w.onafterprint = () => w.close();
  };
  if (w.document.readyState === "complete") {
    setTimeout(trigger, 300);
  } else {
    w.onload = () => setTimeout(trigger, 300);
  }
}

/**
 * Download the full plan proposal as PDF (one sheet per matrix / soldier / stats table).
 */
export async function downloadPlanReportPdf(input: PlanReportInput): Promise<void> {
  const html = buildPlanReportHtml(input);
  const filename = planReportPdfFilename(input.proposal.anchor_date, input.slot);
  const iframe = createReportIframe();
  document.body.appendChild(iframe);

  try {
    const doc = await loadReportDocument(iframe, html);
    try {
      await saveReportPdf(doc, filename);
    } catch {
      printPlanReportPdf(html, filename);
    }
  } finally {
    document.body.removeChild(iframe);
  }
}
