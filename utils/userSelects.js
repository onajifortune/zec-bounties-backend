const USER_SELECT = { id: true, name: true, nickname: true, avatar: true };

const USER_SELECT_PUBLIC = USER_SELECT;

const USER_SELECT_FULL = {
  id: true,
  name: true,
  nickname: true,
  email: true,
  avatar: true,
  z_address: true,
  UA_address: true,
};

const USER_SELECT_WITH_ROLE = {
  id: true,
  name: true,
  nickname: true,
  email: true,
  role: true,
  avatar: true,
};

const USER_SELECT_BASIC = {
  id: true,
  name: true,
  nickname: true,
  email: true,
  avatar: true,
};

const USER_SELECT_MINIMAL = {
  id: true,
  name: true,
  nickname: true,
  email: true,
  discordUsername: true,
};

const USER_SELECT_EXPORT = {
  id: true,
  name: true,
  nickname: true,
  email: true,
  z_address: true,
  UA_address: true,
  ofacVerified: true,
};

module.exports = {
  USER_SELECT,
  USER_SELECT_PUBLIC,
  USER_SELECT_FULL,
  USER_SELECT_WITH_ROLE,
  USER_SELECT_BASIC,
  USER_SELECT_MINIMAL,
  USER_SELECT_EXPORT,
};
