import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { AssistantAnswer, AssistantService } from '../../assistant.service';

// "Ask the portfolio": one question at a time, answered by core-api's
// assistant from live adapter data. Read-only on the server side.
@Component({
  selector: 'app-assistant-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './assistant-panel.component.html',
  styleUrl: './assistant-panel.component.css',
})
export class AssistantPanelComponent {
  question = '';
  asking = false;
  result: AssistantAnswer | null = null;
  error: string | null = null;

  readonly examples = [
    'Which projects are offline right now?',
    'Which applications need a follow-up, oldest first?',
    'Which skill gaps show up most in my rejections?',
  ];

  constructor(private assistant: AssistantService) {}

  ask(question = this.question): void {
    const q = question.trim();
    if (q.length < 3 || this.asking) return;
    this.question = q;
    this.asking = true;
    this.error = null;
    this.assistant.ask(q).subscribe({
      next: (res) => {
        this.result = res;
        this.asking = false;
      },
      error: (err: HttpErrorResponse) => {
        this.error = err.error?.message ?? 'The assistant could not answer. Try again.';
        this.asking = false;
      },
    });
  }

  onKeydown(event: KeyboardEvent): void {
    // Enter asks; Shift+Enter adds a new line.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.ask();
    }
  }
}
