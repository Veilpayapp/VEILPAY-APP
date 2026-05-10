export const ANALYTICS_EVENTS = {
  SCREEN_VIEW: 'screen_view',

  ONBOARDING_GET_STARTED: 'onboarding_get_started',
  ONBOARDING_RESTORE_VAULT: 'onboarding_restore_vault',

  WALLET_CONNECT_VIEWED: 'wallet_connect_viewed',
  WALLET_CONNECT_URI_RECEIVED: 'wallet_connect_uri_received',
  WALLET_CONNECT_CALLBACK_ERROR: 'wallet_connect_callback_error',
  WALLET_CONNECT_CALLBACK_RECEIVED: 'wallet_connect_callback_received',
  WALLET_CONNECT_CALLBACK_SUCCESS: 'wallet_connect_callback_success',
  WALLET_CONNECT_CALLBACK_FAILED: 'wallet_connect_callback_failed',
  WALLET_CONNECT_BACK_PRESSED: 'wallet_connect_back_pressed',
  WALLET_CONNECT_INTERNAL_CREATE_SELECTED: 'wallet_connect_internal_create_selected',
  WALLET_CONNECT_INTERNAL_IMPORT_SELECTED: 'wallet_connect_internal_import_selected',
  WALLET_CONNECT_EXTERNAL_BLOCKED_COOLDOWN: 'wallet_connect_external_blocked_cooldown',
  WALLET_CONNECT_EXTERNAL_THROTTLED: 'wallet_connect_external_throttled',
  WALLET_CONNECT_EXTERNAL_ATTEMPT_STARTED: 'wallet_connect_external_attempt_started',
  WALLET_CONNECT_EXTERNAL_DEMO_SUCCESS: 'wallet_connect_external_demo_success',
  WALLET_CONNECT_SDK_URI_CREATED: 'wallet_connect_sdk_uri_created',
  WALLET_CONNECT_EXTERNAL_APP_OPENED: 'wallet_connect_external_app_opened',
  WALLET_CONNECT_SDK_APPROVED: 'wallet_connect_sdk_approved',
  WALLET_CONNECT_EXTERNAL_FAILED: 'wallet_connect_external_failed',

  SEND_PAYMENT_VIEWED: 'send_payment_viewed',
  SEND_PAYMENT_BACK_PRESSED: 'send_payment_back_pressed',
  SEND_PAYMENT_SCAN_QR_PRESSED: 'send_payment_scan_qr_pressed',
  SEND_PAYMENT_PASTE_FAILED: 'send_payment_paste_failed',
  SEND_PAYMENT_PASTE_SUCCESS: 'send_payment_paste_success',
  SEND_PAYMENT_VALIDATION_FAILED: 'send_payment_validation_failed',
  SEND_PAYMENT_CONTINUE_PRESSED: 'send_payment_continue_pressed',
  SEND_PAYMENT_TOKEN_SELECTOR_OPENED: 'send_payment_token_selector_opened',
  SEND_PAYMENT_TOKEN_SELECTED: 'send_payment_token_selected',
  SEND_PAYMENT_QUICK_AMOUNT_SELECTED: 'send_payment_quick_amount_selected',

  PRIVACY_LEVEL_VIEWED: 'privacy_level_viewed',
  PRIVACY_LEVEL_BACK_PRESSED: 'privacy_level_back_pressed',
  PRIVACY_LEVEL_SELECTED: 'privacy_level_selected',
  PRIVACY_LEVEL_CONTINUE_PRESSED: 'privacy_level_continue_pressed',

  PAYMENT_CONFIRMATION_VIEWED: 'payment_confirmation_viewed',
  PAYMENT_CONFIRMATION_BACK_PRESSED: 'payment_confirmation_back_pressed',
  PAYMENT_SEND_VALIDATION_FAILED: 'payment_send_validation_failed',
  PAYMENT_SEND_ATTEMPTED: 'payment_send_attempted',
  PAYMENT_SEND_SUBMITTED: 'payment_send_submitted',
  PAYMENT_SEND_CONFIRMED: 'payment_send_confirmed',
  PAYMENT_SEND_FAILED: 'payment_send_failed',
  PAYMENT_VIEW_EXPLORER_PRESSED: 'payment_view_explorer_pressed',
  PAYMENT_FAUCET_PRESSED: 'payment_faucet_pressed',
  PAYMENT_GO_HOME_PRESSED: 'payment_go_home_pressed',

  RECEIVE_QR_VIEWED: 'receive_qr_viewed',
  RECEIVE_QR_BACK_PRESSED: 'receive_qr_back_pressed',
  RECEIVE_ADDRESS_COPY_FAILED: 'receive_address_copy_failed',
  RECEIVE_ADDRESS_COPIED: 'receive_address_copied',
  RECEIVE_ADDRESS_SHARE_FAILED: 'receive_address_share_failed',
  RECEIVE_ADDRESS_SHARED: 'receive_address_shared',
  RECEIVE_REQUEST_LINK_FAILED: 'receive_request_link_failed',
  RECEIVE_REQUEST_LINK_COPIED: 'receive_request_link_copied',

  QR_SCANNER_VIEWED: 'qr_scanner_viewed',
  QR_SCAN_SUCCESS: 'qr_scan_success',
  QR_SCAN_FAILED: 'qr_scan_failed',
  QR_SCANNER_OPEN_SETTINGS_PRESSED: 'qr_scanner_open_settings_pressed',
  QR_SCANNER_PERMISSION_REQUESTED: 'qr_scanner_permission_requested',
  QR_SCANNER_CLOSE_PRESSED: 'qr_scanner_close_pressed',
  QR_SCANNER_FLASH_TOGGLED: 'qr_scanner_flash_toggled',

  TRANSACTION_HISTORY_VIEWED: 'transaction_history_viewed',
  TRANSACTION_HISTORY_REFRESH_REQUESTED: 'transaction_history_refresh_requested',
  TRANSACTION_HISTORY_REFRESH_COMPLETED: 'transaction_history_refresh_completed',
  TRANSACTION_HISTORY_REFRESH_FAILED: 'transaction_history_refresh_failed',
  TRANSACTION_HISTORY_LOAD_MORE_REQUESTED: 'transaction_history_load_more_requested',
  TRANSACTION_DETAILS_OPENED_FROM_HISTORY: 'transaction_details_opened_from_history',
  TRANSACTION_HISTORY_FILTER_CHANGED: 'transaction_history_filter_changed',
  TRANSACTION_HISTORY_EMPTY_SEND_PAYMENT_PRESSED: 'transaction_history_empty_send_payment_pressed',
  TRANSACTION_HISTORY_BACK_PRESSED: 'transaction_history_back_pressed',

  TRANSACTION_DETAILS_VIEWED: 'transaction_details_viewed',
  TRANSACTION_DETAILS_VIEW_EXPLORER_PRESSED: 'transaction_details_view_explorer_pressed',
  TRANSACTION_DETAILS_VIEW_EXPLORER_FAILED: 'transaction_details_view_explorer_failed',
  TRANSACTION_DETAILS_COPY_SUCCESS: 'transaction_details_copy_success',
  TRANSACTION_DETAILS_COPY_FAILED: 'transaction_details_copy_failed',
  TRANSACTION_DETAILS_BACK_PRESSED: 'transaction_details_back_pressed',
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

export type AnalyticsPayload = Record<string, unknown>;

export type AnalyticsEventPayloadMap = {
  [K in AnalyticsEventName]?: AnalyticsPayload;
} & {
  [ANALYTICS_EVENTS.SCREEN_VIEW]: AnalyticsPayload & {
    screen_name: string;
  };
};
