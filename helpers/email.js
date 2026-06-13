const formatEmailText = (text) => {
  if (!text) return "";
  return text.replace(/\n/g, "<br/>");
};

module.exports = { formatEmailText };
