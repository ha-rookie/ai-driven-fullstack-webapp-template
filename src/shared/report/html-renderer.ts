import type { GeneratedReportBinary, ReportDefinition, ReportRenderer, ReportViewModel } from "./report";

const escapeHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

export interface HtmlReportTemplate<TData> {
  readonly renderBody: (data: TData) => string;
  readonly title: (viewModel: ReportViewModel<TData>) => string;
  readonly filename: (viewModel: ReportViewModel<TData>) => string;
}

export class SafeHtmlReportRenderer<TData> implements ReportRenderer<TData> {
  readonly outputType = "html" as const;

  constructor(private readonly template: HtmlReportTemplate<TData>) {}

  async render(input: {
    readonly definition: ReportDefinition;
    readonly viewModel: ReportViewModel<TData>;
  }): Promise<GeneratedReportBinary> {
    const title = escapeHtml(this.template.title(input.viewModel));
    const body = this.template.renderBody(input.viewModel.data);
    const html = `<!doctype html><html lang="${escapeHtml(input.viewModel.locale)}"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
    return {
      body: new TextEncoder().encode(html),
      contentType: "text/html; charset=utf-8",
      filename: this.template.filename(input.viewModel),
    };
  }
}

export { escapeHtml };
