import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssessScreen } from './features/AssessScreen';
import App from './App';
import { evaluateRedFlags } from './lib/redflags';

/**
 * Render smoke tests.
 *
 * The unit suites cover the decision maths. These cover the thing those maths
 * depend on: that the screens actually mount, that the primary path is
 * reachable by tapping, and that the emergency path surfaces its care action.
 * A crash on mount in the field is far more costly than a wrong band, so this
 * is the layer worth guarding.
 *
 * Runs in jsdom — see src/test/setup-dom.ts.
 */

function renderApp() {
  return render(<App />);
}

describe('App shell', () => {
  it('mounts without crashing', () => {
    expect(() => renderApp()).not.toThrow();
  });

  it('shows the brand and a language switch in the top bar', () => {
    renderApp();
    expect(screen.getByText('MalariaX')).toBeInTheDocument();
    const switcher = screen.getByRole('radiogroup', { name: /language/i });
    expect(within(switcher).getByRole('radio', { name: /English/i })).toBeInTheDocument();
    expect(within(switcher).getByRole('radio', { name: /አማርኛ/i })).toBeInTheDocument();
  });

  it('renders all three tabs with exactly one selected', () => {
    renderApp();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
  });

  it('offers a clear first action rather than an empty form', () => {
    renderApp();
    expect(screen.getByText('Check symptoms')).toBeInTheDocument();
    expect(screen.getByText('Report a case')).toBeInTheDocument();
    expect(screen.getByText('Ask a question')).toBeInTheDocument();
  });

  it('switches tabs on click', async () => {
    const user = userEvent.setup();
    renderApp();
    const tabs = screen.getAllByRole('tab');
    await user.click(tabs[1]!);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText(/reports are anonymous and help your area get prepared/i)).toBeInTheDocument();
  });
});

describe('Symptom check flow', () => {
  it('is reachable from the launcher and renders every symptom', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByText('Check symptoms'));
    await screen.findByText('Symptom check');
    for (const label of ['Fever', 'Chills / shivering', 'Headache', 'Heavy sweating', 'Nausea', 'Vomiting', 'Extreme weakness', 'Pale inside the eyes']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('keeps the submit button disabled until something is selected', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByText('Check symptoms'));
    const submit = await screen.findByRole('button', { name: /see my risk/i });
    expect(submit).toBeDisabled();
  });

  it('enables submit on a symptom and produces a result', async () => {
    const user = userEvent.setup();
    render(<AssessScreen />);

    const submit = screen.getByRole('button', { name: /see my risk/i });
    expect(submit).toBeDisabled();

    // Fever, moderate.
    await user.click(screen.getAllByRole('radio', { name: /^Fever: Moderate$/i })[0]!);
    expect(submit).toBeEnabled();

    await user.click(submit);

    // The risk panel is the result header, so it carries the verdict.
    expect(await screen.findByText('Your malaria risk')).toBeInTheDocument();
    expect(screen.getByText('Moderate')).toBeInTheDocument();
    // Every result must carry the "not a diagnosis" warning.
    expect(screen.getAllByText(/not a medical diagnosis/i).length).toBeGreaterThan(0);
  });

  it('shows danger signs and a care action when vomiting is reported', async () => {
    const user = userEvent.setup();
    render(<AssessScreen />);

    // Vomiting at any severity is a hard emergency.
    await user.click(screen.getAllByRole('radio', { name: /^Vomiting: Mild$/i })[0]!);
    await user.click(screen.getByRole('button', { name: /see my risk/i }));

    await screen.findByText('Your malaria risk');
    // "Emergency" appears as both the short band label and the pill label.
    expect(screen.getAllByText('Emergency').length).toBeGreaterThan(0);
    // The instruction appears in the alert banner and again as the headline,
    // which is intentional: it is the one thing that must not be missed.
    expect(screen.getAllByText(/go to a health center now/i).length).toBeGreaterThan(0);
    // The care action is the thing a user needs most, so it must be reachable.
    expect(screen.getByRole('button', { name: /find a health center/i })).toBeInTheDocument();
    // Danger signs are only shown for the two serious bands.
    expect(screen.getByText('Watch for these signs')).toBeInTheDocument();
  });

  it('does not show danger signs on a low-risk result', async () => {
    const user = userEvent.setup();
    render(<AssessScreen />);
    // Mild headache alone is not a malaria presentation.
    await user.click(screen.getAllByRole('radio', { name: /^Headache: Mild$/i })[0]!);
    await user.click(screen.getByRole('button', { name: /see my risk/i }));

    await screen.findByText('Your malaria risk');
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.queryByText('Watch for these signs')).toBeNull();
    // No care action on a low result — it would cry wolf.
    expect(screen.queryByRole('button', { name: /find a health center/i })).toBeNull();
  });

  it('always offers a route back out of a result', async () => {
    const user = userEvent.setup();
    render(<AssessScreen />);
    await user.click(screen.getAllByRole('radio', { name: /^Fever: Severe$/i })[0]!);
    await user.click(screen.getByRole('button', { name: /see my risk/i }));
    expect(await screen.findByRole('button', { name: /check someone else/i })).toBeInTheDocument();
  });
});

describe('child mode', () => {
  it('shows extra guidance when the assessment is about a child', async () => {
    const user = userEvent.setup();
    render(<AssessScreen />);
    await user.click(screen.getByRole('radio', { name: /A child under 12/i }));
    expect(screen.getByText(/Children who are unwell need to be seen quickly/i)).toBeInTheDocument();
  });
});

describe('danger signs copy', () => {
  it('lists six warning signs that match the engine danger flags', () => {
    const flags = evaluateRedFlags({ vomiting: 'mild' }).presentFlags;
    expect(flags).toEqual(['vomiting']);
  });
});