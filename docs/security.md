# 보안 및 의료정보 보호

- 기본적으로 외부 API 호출이 없습니다. 배포망 egress 차단을 권장합니다.
- 원본 DICOM은 수정하지 않고 보호된 저장소에 보존합니다.
- Patient ID는 keyed SHA-256으로 가명화합니다. 재식별 매핑은 별도 암호화 저장소에 둡니다.
- PHI 값, 원본 annotation payload, 토큰을 애플리케이션 로그에 남기지 않습니다.
- 업로드는 확장자, MIME, 크기, 실제 decode 여부를 검증하고 서버 UUID 파일명을 씁니다.
- asset 조회, annotation, review, export는 role과 project 범위를 확인합니다.

MVP의 DICOM tag screening은 알려진 PHI tag를 감지합니다. 픽셀에 구워진 개인정보는 자동 안전 판정하지 않으며 사람이 검수해야 합니다.
