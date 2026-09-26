import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AssistantPanelComponent } from './assistant-panel.component';
import { API_BASE } from '../../auth/auth.service';

describe('AssistantPanelComponent', () => {
  let fixture: ComponentFixture<AssistantPanelComponent>;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AssistantPanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(AssistantPanelComponent);
    backend = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => backend.verify());

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('asks an example question and shows the answer with the tools it used', () => {
    const chip = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.chip')!;
    chip.click();

    const req = backend.expectOne(`${API_BASE}/assistant/ask`);
    expect(req.request.body).toEqual({ question: 'Which projects are offline right now?' });
    req.flush({ answer: 'wUtility is offline.', toolsUsed: ['list_projects'], usage: { inputTokens: 1, outputTokens: 1 } });
    fixture.detectChanges();

    expect(text()).toContain('wUtility is offline.');
    expect(text()).toContain('list_projects');
  });

  it("shows the server's message when the assistant isn't available", () => {
    fixture.componentInstance.ask('Anything new?');
    backend.expectOne(`${API_BASE}/assistant/ask`).flush(
      { message: 'The assistant is not configured (ANTHROPIC_API_KEY is not set on core-api).' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    fixture.detectChanges();

    expect(text()).toContain('not configured');
  });

  it('ignores a question that is too short', () => {
    fixture.componentInstance.ask('hi');
    backend.expectNone(`${API_BASE}/assistant/ask`);
  });
});
