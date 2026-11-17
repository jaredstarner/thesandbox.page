// /breadboard/: the bench. Wires the board, the solver, the drawing, and the controls together.

const root = document.querySelector<HTMLElement>('.bb');
if (root) root.dataset.ready = '1';
