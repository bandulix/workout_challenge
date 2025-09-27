import { createSlice } from '@reduxjs/toolkit';

const modalQueueSlice = createSlice({
  name: 'modalQueue',
  initialState: {
    queue: [], // array of { type, props }
    currentModal: null,
  },
  reducers: {
    enqueueModal: (state, action) => {
      state.queue.push(action.payload);
      if (!state.currentModal) {
        state.currentModal = state.queue.shift();
      }
    },
    closeModal: (state) => {
      state.currentModal = state.queue.shift() || null;
    },
    clearQueue: (state) => {
      state.queue = [];
      state.currentModal = null;
    },
  },
});

export const { enqueueModal, closeModal, clearQueue } = modalQueueSlice.actions;
export default modalQueueSlice.reducer;