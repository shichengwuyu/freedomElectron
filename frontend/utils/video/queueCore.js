export function sameShotNo(left, right) {
  return String(left) === String(right);
}

export function videoQueueHasShot(items, shotNo) {
  return (Array.isArray(items) ? items : []).some((item) => sameShotNo(item?.no, shotNo));
}

export function removeShotFromVideoQueue(items, shotNo) {
  if (!Array.isArray(items)) return false;
  const index = items.findIndex((item) => sameShotNo(item?.no, shotNo));
  if (index < 0) return false;
  items.splice(index, 1);
  return true;
}
